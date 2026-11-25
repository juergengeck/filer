#include <napi.h>
#include <windows.h>
#include <projectedfslib.h>
#include <shlobj.h>
#include <algorithm>
#include <cmath>
#include <map>
#include <mutex>
#include <string>
#include <vector>

// ProjFS owns placeholders. ONE owns metadata and bytes. No native ONE storage
// interpretation, speculative metadata cache, polling thread or content cache.
namespace {
std::wstring Wide(const std::string& value) {
    if (value.empty()) return {};
    int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), (int)value.size(), nullptr, 0);
    if (!size) throw std::runtime_error("Invalid UTF-8 path");
    std::wstring result(size, 0);
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), (int)value.size(), result.data(), size);
    return result;
}
std::string Utf8(const std::wstring& value) {
    if (value.empty()) return {};
    int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), (int)value.size(), nullptr, 0, nullptr, nullptr);
    std::string result(size, 0);
    WideCharToMultiByte(CP_UTF8, 0, value.data(), (int)value.size(), result.data(), size, nullptr, nullptr);
    return result;
}
std::string VirtualPath(PCWSTR path) {
    std::string result = "/" + Utf8(path);
    std::replace(result.begin(), result.end(), '\\', '/');
    return result;
}
std::wstring Relative(const std::string& path) {
    if (path.empty() || path[0] != '/') throw std::runtime_error("Expected absolute virtual path");
    auto result = Wide(path.substr(1));
    std::replace(result.begin(), result.end(), L'/', L'\\');
    return result;
}
void Check(Napi::Env env, HRESULT hr, const char* operation) {
    if (FAILED(hr)) {
        auto error = Napi::Error::New(env, std::string(operation) + " failed: " + std::to_string((uint32_t)hr));
        error.Value().Set("hresult", Napi::Number::New(env, (uint32_t)hr));
        throw error;
    }
}
LARGE_INTEGER ToFileTime(double epochMs) {
    LARGE_INTEGER result{};
    constexpr double kEpochDiffMs = 11644473600000.0;
    if (std::isfinite(epochMs) && epochMs >= -kEpochDiffMs) {
        result.QuadPart = static_cast<LONGLONG>((epochMs + kEpochDiffMs) * 10000.0);
    }
    return result;
}
std::string NormalizeRootPrefix(const std::string& raw) {
    if (raw.empty() || raw[0] != '/') throw std::runtime_error("Expected absolute writable root");
    return raw.back() == '/' ? raw : raw + "/";
}
struct Entry { std::wstring name; PRJ_PLACEHOLDER_INFO info{}; };
Entry ParseEntry(const Napi::Object& value) {
    Entry entry;
    entry.name = Wide(value.Get("name").As<Napi::String>().Utf8Value());
    entry.info.FileBasicInfo.IsDirectory = value.Get("isDirectory").As<Napi::Boolean>().Value();
    entry.info.FileBasicInfo.FileSize = value.Get("size").As<Napi::Number>().Int64Value();
    entry.info.FileBasicInfo.FileAttributes = entry.info.FileBasicInfo.IsDirectory ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_READONLY;
    if (value.Has("ctimeMs") && value.Get("ctimeMs").IsNumber()) {
        entry.info.FileBasicInfo.CreationTime = ToFileTime(value.Get("ctimeMs").As<Napi::Number>().DoubleValue());
    }
    if (value.Has("mtimeMs") && value.Get("mtimeMs").IsNumber()) {
        auto mtime = ToFileTime(value.Get("mtimeMs").As<Napi::Number>().DoubleValue());
        entry.info.FileBasicInfo.LastWriteTime = mtime;
        entry.info.FileBasicInfo.ChangeTime = mtime;
        if (entry.info.FileBasicInfo.CreationTime.QuadPart == 0) {
            entry.info.FileBasicInfo.CreationTime = mtime;
        }
    }
    for (const auto& field : {std::make_pair("contentVersion", entry.info.VersionInfo.ContentID),
                              std::make_pair("metadataVersion", entry.info.VersionInfo.ProviderID)}) {
        auto version = value.Get(field.first).As<Napi::String>().Utf8Value();
        if (version.size() > PRJ_PLACEHOLDER_ID_LENGTH) throw std::runtime_error("Placeholder version is too long");
        memcpy(field.second, version.data(), version.size());
    }
    return entry;
}
struct Enumeration { std::vector<Entry> entries; size_t index = 0; bool loaded = false; std::wstring search; };
struct Request {
    std::string operation; std::wstring path; GUID stream{}; std::string version;
    UINT64 offset = 0; UINT32 length = 0;
    std::string enumeration; PRJ_DIR_ENTRY_BUFFER_HANDLE buffer = nullptr;
};
std::string GuidKey(const GUID& guid) { return std::string(reinterpret_cast<const char*>(&guid), sizeof(guid)); }

class Bridge : public Napi::ObjectWrap<Bridge> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        exports.Set("IFSProjFSProvider", DefineClass(env, "IFSProjFSProvider", {
            InstanceMethod("start", &Bridge::Start), InstanceMethod("stop", &Bridge::Stop),
            InstanceMethod("isRunning", &Bridge::IsRunning), InstanceMethod("complete", &Bridge::Complete),
            InstanceMethod("writeData", &Bridge::WriteData), InstanceMethod("invalidate", &Bridge::Invalidate),
            InstanceMethod("compareNames", &Bridge::CompareNames),
            InstanceMethod("setWritableRoots", &Bridge::SetWritableRoots),
            InstanceMethod("getStats", &Bridge::GetStats)
        }));
        return exports;
    }
    Bridge(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Bridge>(info) {}
    ~Bridge() { StopNative(); }
private:
    PRJ_NAMESPACE_VIRTUALIZATION_CONTEXT context_ = nullptr;
    Napi::ThreadSafeFunction dispatch_;
    std::mutex mutex_;
    std::map<INT32, Request> requests_;
    std::map<std::string, Enumeration> enumerations_;
    std::wstring root_;
    uint64_t bytesRead_ = 0, rangeWrites_ = 0;
    bool active_ = false;
    bool importEnabled_ = false;
    std::vector<std::wstring> writablePrefixes_;
    static std::vector<std::wstring> ParseWritableRoots(const Napi::Value& arg) {
        std::vector<std::wstring> prefixes;
        if (arg.IsBoolean()) {
            if (arg.As<Napi::Boolean>().Value()) prefixes.push_back(L"Files\\");
            return prefixes;
        }
        if (arg.IsArray()) {
            auto array = arg.As<Napi::Array>();
            for (uint32_t i = 0; i < array.Length(); i++) {
                auto prefix = NormalizeRootPrefix(array.Get(i).As<Napi::String>().Utf8Value());
                prefixes.push_back(Relative(prefix));
            }
            return prefixes;
        }
        throw std::runtime_error("Expected boolean or string[] for writable roots");
    }
    bool IsWritableRelativePath(PCWSTR relativePath) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!importEnabled_ || !relativePath) return false;
        for (const auto& prefix : writablePrefixes_) {
            if (prefix.empty() || _wcsnicmp(relativePath, prefix.c_str(), prefix.size()) == 0) return true;
        }
        return false;
    }
    Napi::Value SetWritableRoots(const Napi::CallbackInfo& info) {
        auto prefixes = ParseWritableRoots(info[0]);
        std::lock_guard<std::mutex> lock(mutex_);
        writablePrefixes_ = std::move(prefixes);
        importEnabled_ = !writablePrefixes_.empty();
        return info.Env().Undefined();
    }
    static Bridge* Self(const PRJ_CALLBACK_DATA* data) { return static_cast<Bridge*>(data->InstanceContext); }
    Napi::Value CompareNames(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), PrjFileNameCompare(
            Wide(info[0].As<Napi::String>().Utf8Value()).c_str(), Wide(info[1].As<Napi::String>().Utf8Value()).c_str()));
    }
    // Queued calls copy callback values, never pointers into callbackData.
    HRESULT Queue(const PRJ_CALLBACK_DATA* data, Request request) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!active_) return HRESULT_FROM_WIN32(ERROR_OPERATION_ABORTED);
        if (requests_.size() >= 256) return HRESULT_FROM_WIN32(ERROR_BUSY);
        const INT32 id = data->CommandId;
        request.path = data->FilePathName; request.stream = data->DataStreamId;
        if (data->VersionInfo) {
            const auto* version = reinterpret_cast<const char*>(data->VersionInfo->ContentID);
            request.version.assign(version, strnlen(version, PRJ_PLACEHOLDER_ID_LENGTH));
        }
        requests_[id] = request;
        auto status = dispatch_.NonBlockingCall([id, request](Napi::Env env, Napi::Function callback) {
            if (!env || !callback) return;
            auto value = Napi::Object::New(env);
            value.Set("id", id); value.Set("operation", request.operation);
            value.Set("path", VirtualPath(request.path.c_str()));
            value.Set("position", Napi::Number::New(env, (double)request.offset)); value.Set("length", request.length);
            value.Set("contentVersion", request.version);
            callback.Call({value});
        });
        if (status != napi_ok) { requests_.erase(id); return E_OUTOFMEMORY; }
        return HRESULT_FROM_WIN32(ERROR_IO_PENDING);
    }
    static HRESULT CALLBACK Placeholder(const PRJ_CALLBACK_DATA* data) { Request r; r.operation = "stat"; return Self(data)->Queue(data, r); }
    static HRESULT CALLBACK Query(const PRJ_CALLBACK_DATA* data) { Request r; r.operation = "query"; return Self(data)->Queue(data, r); }
    static HRESULT CALLBACK Read(const PRJ_CALLBACK_DATA* data, UINT64 offset, UINT32 length) {
        Request r; r.operation = "read"; r.offset = offset; r.length = length; return Self(data)->Queue(data, r);
    }
    static HRESULT CALLBACK Begin(const PRJ_CALLBACK_DATA* data, const GUID* id) {
        auto self = Self(data); std::lock_guard<std::mutex> lock(self->mutex_);
        self->enumerations_[GuidKey(*id)] = Enumeration{}; return S_OK;
    }
    static HRESULT CALLBACK End(const PRJ_CALLBACK_DATA* data, const GUID* id) {
        auto self = Self(data); std::lock_guard<std::mutex> lock(self->mutex_);
        self->enumerations_.erase(GuidKey(*id)); return S_OK;
    }
    static HRESULT Fill(Enumeration& state, PRJ_DIR_ENTRY_BUFFER_HANDLE buffer) {
        bool filled = false;
        while (state.index < state.entries.size()) {
            auto& entry = state.entries[state.index];
            if (state.search.empty() || PrjFileNameMatch(entry.name.c_str(), state.search.c_str())) {
                HRESULT hr = PrjFillDirEntryBuffer(entry.name.c_str(), &entry.info.FileBasicInfo, buffer);
                if (hr == HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER)) return filled ? S_OK : hr;
                if (FAILED(hr)) return hr;
                filled = true;
            }
            state.index++;
        }
        return S_OK;
    }
    static HRESULT CALLBACK Enumerate(const PRJ_CALLBACK_DATA* data, const GUID* id, PCWSTR search, PRJ_DIR_ENTRY_BUFFER_HANDLE buffer) {
        auto self = Self(data); auto key = GuidKey(*id);
        {
            std::lock_guard<std::mutex> lock(self->mutex_);
            auto found = self->enumerations_.find(key);
            if (found == self->enumerations_.end()) return E_INVALIDARG;
            auto& state = found->second;
            if (!state.loaded || (data->Flags & PRJ_CB_DATA_FLAG_ENUM_RESTART_SCAN)) {
                state.index = 0; state.search = search ? search : L"";
            }
            if (state.loaded) return Fill(state, buffer);
        }
        Request r; r.operation = "list"; r.enumeration = key; r.buffer = buffer; return self->Queue(data, r);
    }
    static void CALLBACK Cancel(const PRJ_CALLBACK_DATA* data) {
        auto self = Self(data); std::lock_guard<std::mutex> lock(self->mutex_);
        self->requests_.erase(data->CommandId);
        if (!self->active_) return;
        auto id = data->CommandId;
        self->dispatch_.NonBlockingCall([id](Napi::Env env, Napi::Function callback) {
            if (!env || !callback) return;
            auto value = Napi::Object::New(env); value.Set("operation", "cancel"); value.Set("id", id); callback.Call({value});
        });
    }
    static HRESULT CALLBACK Notify(const PRJ_CALLBACK_DATA* data, BOOLEAN directory, PRJ_NOTIFICATION notification,
        PCWSTR destination, PRJ_NOTIFICATION_PARAMETERS* parameters) {
        if (getenv("ONE_PROJFS_DEBUG")) fprintf(stderr, "[ProjFS notification] %x %ls\n", notification, data->FilePathName);
        if (notification == PRJ_NOTIFICATION_PRE_DELETE || notification == PRJ_NOTIFICATION_PRE_RENAME ||
            notification == PRJ_NOTIFICATION_PRE_SET_HARDLINK || notification == PRJ_NOTIFICATION_FILE_PRE_CONVERT_TO_FULL)
            return HRESULT_FROM_WIN32(ERROR_ACCESS_DENIED);
        auto path = VirtualPath(data->FilePathName);
        if (notification == PRJ_NOTIFICATION_NEW_FILE_CREATED || notification == PRJ_NOTIFICATION_FILE_OVERWRITTEN) {
            if (!Self(data)->IsWritableRelativePath(data->FilePathName)) return HRESULT_FROM_WIN32(ERROR_ACCESS_DENIED);
        }
        if ((notification == PRJ_NOTIFICATION_NEW_FILE_CREATED && directory) ||
            (!directory && (notification == PRJ_NOTIFICATION_FILE_HANDLE_CLOSED_FILE_MODIFIED ||
                           notification == PRJ_NOTIFICATION_FILE_HANDLE_CLOSED_NO_MODIFICATION))) {
            if (!Self(data)->IsWritableRelativePath(data->FilePathName)) return S_OK;
            // Only full local files need import. Hydrated placeholders are already owned.
            PRJ_FILE_STATE state{};
            auto full = Self(data)->root_ + L"\\" + data->FilePathName;
            HRESULT stateHr = PrjGetOnDiskFileState(full.c_str(), &state);
            if (getenv("ONE_PROJFS_DEBUG")) fprintf(stderr, "[ProjFS local state] %x %x\n", (unsigned)stateHr, state);
            if (FAILED(stateHr) || !(state & PRJ_FILE_STATE_FULL)) return S_OK;
            auto self = Self(data); std::lock_guard<std::mutex> lock(self->mutex_);
            if (!self->active_) return S_OK;
            auto status = self->dispatch_.NonBlockingCall([path, directory](Napi::Env env, Napi::Function callback) {
                if (!env || !callback) return;
                auto value = Napi::Object::New(env); value.Set("operation", "import");
                value.Set("path", path); value.Set("isDirectory", bool(directory)); callback.Call({value});
            });
            if (status != napi_ok) {
                fprintf(stderr, "ProjFS import notification queue is full; local file retained\n");
                return E_OUTOFMEMORY;
            }
        }
        return S_OK;
    }
    Napi::Value Start(const Napi::CallbackInfo& info) {
        auto env = info.Env(); if (context_) throw Napi::Error::New(env, "Provider already started");
        root_ = Wide(info[0].As<Napi::String>().Utf8Value());
        {
            auto prefixes = ParseWritableRoots(info[2]);
            std::lock_guard<std::mutex> lock(mutex_);
            writablePrefixes_ = std::move(prefixes);
            importEnabled_ = !writablePrefixes_.empty();
        }
        dispatch_ = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "ProjFS requests", 256, 1);
        WIN32_FIND_DATAW rootInfo{};
        HANDLE rootHandle = FindFirstFileW(root_.c_str(), &rootInfo);
        HRESULT hr = rootHandle == INVALID_HANDLE_VALUE ? HRESULT_FROM_WIN32(GetLastError()) : S_OK;
        if (rootHandle != INVALID_HANDLE_VALUE) FindClose(rootHandle);
        if (SUCCEEDED(hr) && (rootInfo.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
            // Reuse the OS-owned root identity on restart. Never remove/rewrite it.
            if (rootInfo.dwReserved0 != IO_REPARSE_TAG_PROJFS) hr = E_INVALIDARG;
        } else if (SUCCEEDED(hr)) {
            GUID id{}; CoCreateGuid(&id);
            hr = PrjMarkDirectoryAsPlaceholder(root_.c_str(), nullptr, nullptr, &id);
        }
        if (FAILED(hr)) { dispatch_.Release(); dispatch_ = {}; Check(env, hr, "Mark root"); }
        PRJ_CALLBACKS callbacks{};
        callbacks.StartDirectoryEnumerationCallback = Begin; callbacks.EndDirectoryEnumerationCallback = End;
        callbacks.GetDirectoryEnumerationCallback = Enumerate; callbacks.GetPlaceholderInfoCallback = Placeholder;
        callbacks.GetFileDataCallback = Read; callbacks.QueryFileNameCallback = Query;
        callbacks.CancelCommandCallback = Cancel; callbacks.NotificationCallback = Notify;
        PRJ_NOTIFICATION_MAPPING mapping{}; mapping.NotificationRoot = L"";
        mapping.NotificationBitMask = PRJ_NOTIFY_NEW_FILE_CREATED | PRJ_NOTIFY_FILE_OVERWRITTEN |
            PRJ_NOTIFY_PRE_DELETE | PRJ_NOTIFY_PRE_RENAME | PRJ_NOTIFY_PRE_SET_HARDLINK |
            PRJ_NOTIFY_FILE_PRE_CONVERT_TO_FULL | PRJ_NOTIFY_FILE_HANDLE_CLOSED_FILE_MODIFIED |
            PRJ_NOTIFY_FILE_HANDLE_CLOSED_NO_MODIFICATION;
        PRJ_STARTVIRTUALIZING_OPTIONS options{}; options.NotificationMappings = &mapping; options.NotificationMappingsCount = 1;
        { std::lock_guard<std::mutex> lock(mutex_); active_ = true; }
        hr = PrjStartVirtualizing(root_.c_str(), &callbacks, this, &options, &context_);
        if (FAILED(hr)) {
            { std::lock_guard<std::mutex> lock(mutex_); active_ = false; }
            dispatch_.Release(); dispatch_ = {}; Check(env, hr, "Start virtualization");
        }
        Ref(); return env.Undefined();
    }
    void StopNative() {
        { std::lock_guard<std::mutex> lock(mutex_); active_ = false; }
        if (context_) { PrjStopVirtualizing(context_); context_ = nullptr; }
        { std::lock_guard<std::mutex> lock(mutex_); requests_.clear(); enumerations_.clear(); }
        if (dispatch_) { dispatch_.Release(); dispatch_ = {}; }
    }
    Napi::Value Stop(const Napi::CallbackInfo& info) {
        const bool running = context_ != nullptr; StopNative(); if (running) Unref(); return info.Env().Undefined();
    }
    Napi::Value IsRunning(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), context_ != nullptr); }
    Napi::Value Complete(const Napi::CallbackInfo& info) {
        auto env = info.Env(); std::lock_guard<std::mutex> lock(mutex_);
        auto found = requests_.find(info[0].As<Napi::Number>().Int32Value());
        if (found == requests_.end() || !active_) return env.Undefined();
        auto request = found->second; const INT32 id = found->first; requests_.erase(found);
        HRESULT hr = info[2].IsNumber() ? HRESULT_FROM_WIN32(info[2].As<Napi::Number>().Uint32Value()) : S_OK;
        PRJ_COMPLETE_COMMAND_EXTENDED_PARAMETERS extended{};
        if (SUCCEEDED(hr)) {
            try {
                if (request.operation == "stat") {
                    auto entry = ParseEntry(info[1].As<Napi::Object>());
                    auto ownerPath = Relative(info[1].As<Napi::Object>().Get("path").As<Napi::String>().Utf8Value());
                    hr = PrjWritePlaceholderInfo(context_, ownerPath.c_str(), &entry.info, sizeof(entry.info));
                } else if (request.operation == "list") {
                    auto state = enumerations_.find(request.enumeration);
                    if (state == enumerations_.end()) hr = HRESULT_FROM_WIN32(ERROR_OPERATION_ABORTED);
                    else {
                        auto array = info[1].As<Napi::Array>();
                        for (uint32_t i = 0; i < array.Length(); i++) state->second.entries.push_back(ParseEntry(array.Get(i).As<Napi::Object>()));
                        std::sort(state->second.entries.begin(), state->second.entries.end(), [](const Entry& a, const Entry& b) {
                            return PrjFileNameCompare(a.name.c_str(), b.name.c_str()) < 0;
                        });
                        state->second.loaded = true; hr = Fill(state->second, request.buffer);
                    }
                }
            } catch (const std::exception&) { hr = E_INVALIDARG; }
        }
        if (request.operation == "list") {
            extended.CommandType = PRJ_COMPLETE_COMMAND_TYPE_ENUMERATION;
            extended.Enumeration.DirEntryBufferHandle = request.buffer;
        }
        PrjCompleteCommand(context_, id, hr, request.operation == "list" ? &extended : nullptr);
        return env.Undefined();
    }
    Napi::Value WriteData(const Napi::CallbackInfo& info) {
        auto env = info.Env(); std::lock_guard<std::mutex> lock(mutex_);
        auto found = requests_.find(info[0].As<Napi::Number>().Int32Value());
        if (found == requests_.end() || !active_) return Napi::Boolean::New(env, false);
        auto bytes = info[1].As<Napi::Buffer<uint8_t>>();
        UINT64 position = (UINT64)info[2].As<Napi::Number>().Int64Value();
        if (bytes.Length() > 1024 * 1024 || position < found->second.offset ||
            position + bytes.Length() > found->second.offset + found->second.length) throw Napi::RangeError::New(env, "Invalid hydration range");
        void* buffer = PrjAllocateAlignedBuffer(context_, bytes.Length());
        if (!buffer) throw Napi::Error::New(env, "Aligned allocation failed");
        memcpy(buffer, bytes.Data(), bytes.Length());
        HRESULT hr = PrjWriteFileData(context_, &found->second.stream, buffer, position, (UINT32)bytes.Length());
        PrjFreeAlignedBuffer(buffer); Check(env, hr, "Write hydration range");
        bytesRead_ += bytes.Length(); rangeWrites_++;
        return Napi::Boolean::New(env, true);
    }
    // Physical entries only: normal iteration on the JS thread could request
    // projection and deadlock waiting for JS metadata callbacks.
    HRESULT InvalidateDirectory(const std::wstring& relative) {
        auto absolute = root_ + (relative.empty() ? L"" : L"\\" + relative);
        WIN32_FIND_DATAW data{};
        HANDLE handle = FindFirstFileExW((absolute + L"\\*").c_str(), FindExInfoBasic, &data,
            FindExSearchNameMatch, nullptr, FIND_FIRST_EX_ON_DISK_ENTRIES_ONLY);
        if (handle == INVALID_HANDLE_VALUE) {
            auto error = GetLastError(); return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND ? S_OK : HRESULT_FROM_WIN32(error);
        }
        HRESULT result = S_OK;
        bool localChildren = false;
        do {
            if (wcscmp(data.cFileName, L".") == 0 || wcscmp(data.cFileName, L"..") == 0) continue;
            std::wstring child = relative.empty() ? data.cFileName : relative + L"\\" + data.cFileName;
            auto full = root_ + L"\\" + child;
            PRJ_FILE_STATE state{}; result = PrjGetOnDiskFileState(full.c_str(), &state);
            if (FAILED(result)) break;
            if (!(state & PRJ_FILE_STATE_PLACEHOLDER) || (state & (PRJ_FILE_STATE_DIRTY_PLACEHOLDER | PRJ_FILE_STATE_FULL))) {
                localChildren = true; continue;
            }
            if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
                result = InvalidateDirectory(child);
                if (FAILED(result)) break;
                if (result == S_FALSE) { localChildren = true; continue; }
            }
            PRJ_UPDATE_FAILURE_CAUSES cause{};
            result = PrjDeleteFile(context_, child.c_str(), PRJ_UPDATE_ALLOW_READ_ONLY, &cause);
            if (FAILED(result)) break;
        } while (FindNextFileW(handle, &data));
        FindClose(handle); return SUCCEEDED(result) && localChildren ? S_FALSE : result;
    }
    // Resolve the target through physical parent entries. Opening an unmaterialized
    // target directly would request its placeholder from this blocked JS thread.
    HRESULT InvalidatePath(const std::wstring& parent, const std::wstring& remaining) {
        if (remaining.empty()) return InvalidateDirectory(parent);
        auto separator = remaining.find(L'\\');
        auto component = remaining.substr(0, separator);
        auto absolute = root_ + (parent.empty() ? L"" : L"\\" + parent);
        WIN32_FIND_DATAW data{};
        HANDLE handle = FindFirstFileExW((absolute + L"\\*").c_str(), FindExInfoBasic, &data,
            FindExSearchNameMatch, nullptr, FIND_FIRST_EX_ON_DISK_ENTRIES_ONLY);
        if (handle == INVALID_HANDLE_VALUE) {
            auto error = GetLastError();
            return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND ? S_OK : HRESULT_FROM_WIN32(error);
        }
        HRESULT result = S_OK;
        do {
            if (PrjFileNameCompare(component.c_str(), data.cFileName) != 0) continue;
            if (!(data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
                ((data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && data.dwReserved0 != IO_REPARSE_TAG_PROJFS)) {
                result = E_INVALIDARG;
                break;
            }
            auto child = parent.empty() ? std::wstring(data.cFileName) : parent + L"\\" + data.cFileName;
            result = InvalidatePath(child, separator == std::wstring::npos ? L"" : remaining.substr(separator + 1));
            break;
        } while (FindNextFileW(handle, &data));
        FindClose(handle);
        return result;
    }
    Napi::Value Invalidate(const Napi::CallbackInfo& info) {
        auto env = info.Env(); if (!context_) throw Napi::Error::New(env, "Provider is stopped");
        auto relative = Relative(info[0].As<Napi::String>().Utf8Value());
        HRESULT hr = InvalidatePath(L"", relative);
        Check(env, hr, "Invalidate directory");
        UINT32 cleared = 0; Check(env, PrjClearNegativePathCache(context_, &cleared), "Clear negative cache");
        auto full = root_ + (relative.empty() ? L"" : L"\\" + relative);
        SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATHW, full.c_str(), nullptr); return env.Undefined();
    }
    Napi::Value GetStats(const Napi::CallbackInfo& info) {
        auto result = Napi::Object::New(info.Env()); std::lock_guard<std::mutex> lock(mutex_);
        result.Set("bytesRead", Napi::BigInt::New(info.Env(), bytesRead_));
        result.Set("rangeWrites", Napi::Number::New(info.Env(), (double)rangeWrites_));
        result.Set("pending", Napi::Number::New(info.Env(), (double)requests_.size()));
        result.Set("enumerations", Napi::Number::New(info.Env(), (double)enumerations_.size())); return result;
    }
};
}
Napi::Object Init(Napi::Env env, Napi::Object exports) { return Bridge::Init(env, exports); }
NODE_API_MODULE(ifsprojfs, Init)
