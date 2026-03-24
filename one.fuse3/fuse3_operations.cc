#include <napi.h>
#include <fuse3/fuse.h>
#include <string.h>
#include <errno.h>
#include <mutex>
#include <condition_variable>
#include <future>
#include <unordered_map>
#include <memory>

// External context
struct FuseContext {
    Napi::ThreadSafeFunction tsfn;
    Napi::ObjectReference operations;
    std::string mountPoint;
    struct fuse *fuse;
    std::thread *fuseThread;
    bool mounted;
};

extern std::unordered_map<std::string, std::unique_ptr<FuseContext>> g_contexts;
extern std::mutex g_contexts_mutex;
extern FuseContext* GetContextFromPath(const char* path);

// Helper to call JavaScript operation
template<typename... Args>
static int CallJsOperation(const std::string& opName, const char* path, Args&&... args) {
    FuseContext* ctx = GetContextFromPath(path);
    if (!ctx) return -EIO;
    
    auto promise = std::make_shared<std::promise<int>>();
    std::future<int> future = promise->get_future();
    
    auto callback = [opName, path, promise, ctx, &args...](Napi::Env env, Napi::Function jsCallback) {
        try {
            Napi::Object ops = ctx->operations.Value();
            Napi::Value opFunc = ops.Get(opName);
            
            if (!opFunc.IsFunction()) {
                promise->set_value(-ENOSYS);
                return;
            }
            
            // Create arguments array
            std::vector<napi_value> jsArgs;
            jsArgs.push_back(Napi::String::New(env, path));
            
            // Add additional arguments based on operation
            // This is a simplified version - real implementation would handle each operation's specific args
            
            // Create callback for async result
            auto resultCallback = Napi::Function::New(env, [promise](const Napi::CallbackInfo& info) {
                if (info.Length() > 0 && info[0].IsNumber()) {
                    promise->set_value(info[0].As<Napi::Number>().Int32Value());
                } else {
                    promise->set_value(0);
                }
            });
            
            jsArgs.push_back(resultCallback);
            
            // Call the JavaScript function
            opFunc.As<Napi::Function>().Call(ops, jsArgs);
            
        } catch (...) {
            promise->set_value(-EIO);
        }
    };
    
    ctx->tsfn.BlockingCall(callback);
    return future.get();
}

// FUSE operation implementations
int fuse3_getattr(const char *path, struct stat *stbuf, struct fuse_file_info *fi) {
    fprintf(stderr, "[C++] fuse3_getattr called for path: %s\n", path);
    fflush(stderr);

    FuseContext* ctx = GetContextFromPath(path);
    if (!ctx) {
        fprintf(stderr, "[C++] fuse3_getattr: no context found!\n");
        fflush(stderr);
        return -EIO;
    }

    memset(stbuf, 0, sizeof(struct stat));

    auto promise = std::make_shared<std::promise<int>>();
    std::future<int> future = promise->get_future();

    fprintf(stderr, "[C++] fuse3_getattr: calling ThreadSafeFunction\n");
    fflush(stderr);
    
    auto callback = [path, stbuf, promise, ctx](Napi::Env env, Napi::Function jsCallback) {
        try {
            Napi::Object ops = ctx->operations.Value();
            Napi::Value getattr = ops.Get("getattr");
            
            if (!getattr.IsFunction()) {
                // Default handling for root
                if (strcmp(path, "/") == 0) {
                    stbuf->st_mode = S_IFDIR | 0755;
                    stbuf->st_nlink = 2;
                    promise->set_value(0);
                } else {
                    promise->set_value(-ENOENT);
                }
                return;
            }
            
            // Create callback for result
            auto resultCb = Napi::Function::New(env, [stbuf, promise](const Napi::CallbackInfo& info) {
                if (info.Length() < 2) {
                    promise->set_value(-EINVAL);
                    return;
                }
                
                int err = info[0].As<Napi::Number>().Int32Value();
                if (err != 0) {
                    promise->set_value(err);
                    return;
                }
                
                Napi::Object stat = info[1].As<Napi::Object>();
                
                // Parse stat object
                if (stat.Has("mode")) {
                    stbuf->st_mode = stat.Get("mode").As<Napi::Number>().Uint32Value();
                }
                if (stat.Has("size")) {
                    stbuf->st_size = stat.Get("size").As<Napi::Number>().Int64Value();
                }
                if (stat.Has("uid")) {
                    stbuf->st_uid = stat.Get("uid").As<Napi::Number>().Uint32Value();
                }
                if (stat.Has("gid")) {
                    stbuf->st_gid = stat.Get("gid").As<Napi::Number>().Uint32Value();
                }
                if (stat.Has("mtime")) {
                    stbuf->st_mtime = stat.Get("mtime").As<Napi::Number>().Int64Value();
                }
                if (stat.Has("atime")) {
                    stbuf->st_atime = stat.Get("atime").As<Napi::Number>().Int64Value();
                }
                if (stat.Has("ctime")) {
                    stbuf->st_ctime = stat.Get("ctime").As<Napi::Number>().Int64Value();
                }
                
                promise->set_value(0);
            });
            
            getattr.As<Napi::Function>().Call(ops, {Napi::String::New(env, path), resultCb});
            
        } catch (...) {
            promise->set_value(-EIO);
        }
    };
    
    ctx->tsfn.BlockingCall(callback);
    return future.get();
}

int fuse3_readdir(const char *path, void *buf, fuse_fill_dir_t filler,
                  off_t offset, struct fuse_file_info *fi, enum fuse_readdir_flags flags) {
    fprintf(stderr, "[C++] fuse3_readdir called for path: %s\n", path);
    fflush(stderr);

    FuseContext* ctx = GetContextFromPath(path);
    if (!ctx) {
        fprintf(stderr, "[C++] fuse3_readdir: no context!\n");
        fflush(stderr);
        return -EIO;
    }

    auto promise = std::make_shared<std::promise<int>>();
    std::future<int> future = promise->get_future();

    fprintf(stderr, "[C++] fuse3_readdir: calling ThreadSafeFunction\n");
    fflush(stderr);
    
    auto callback = [path, buf, filler, promise, ctx](Napi::Env env, Napi::Function jsCallback) {
        try {
            Napi::Object ops = ctx->operations.Value();
            Napi::Value readdir = ops.Get("readdir");
            
            if (!readdir.IsFunction()) {
                promise->set_value(-ENOSYS);
                return;
            }
            
            auto resultCb = Napi::Function::New(env, [buf, filler, promise](const Napi::CallbackInfo& info) {
                if (info.Length() < 2) {
                    promise->set_value(-EINVAL);
                    return;
                }
                
                int err = info[0].As<Napi::Number>().Int32Value();
                if (err != 0) {
                    promise->set_value(err);
                    return;
                }
                
                Napi::Array files = info[1].As<Napi::Array>();
                
                // Add . and .. entries
                filler(buf, ".", nullptr, 0, FUSE_FILL_DIR_PLUS);
                filler(buf, "..", nullptr, 0, FUSE_FILL_DIR_PLUS);
                
                // Add files from JavaScript
                for (uint32_t i = 0; i < files.Length(); i++) {
                    std::string filename = files.Get(i).As<Napi::String>().Utf8Value();
                    filler(buf, filename.c_str(), nullptr, 0, FUSE_FILL_DIR_PLUS);
                }
                
                promise->set_value(0);
            });
            
            readdir.As<Napi::Function>().Call(ops, {Napi::String::New(env, path), resultCb});
            
        } catch (...) {
            promise->set_value(-EIO);
        }
    };
    
    ctx->tsfn.BlockingCall(callback);
    return future.get();
}

int fuse3_open(const char *path, struct fuse_file_info *fi) {
    fprintf(stderr, "[C++] fuse3_open called for path: %s\n", path);
    fflush(stderr);

    FuseContext* ctx = GetContextFromPath(path);
    if (!ctx) {
        fprintf(stderr, "[C++] fuse3_open: no context!\n");
        fflush(stderr);
        return -EIO;
    }

    auto promise = std::make_shared<std::promise<int>>();
    std::future<int> future = promise->get_future();

    int flags = fi->flags;

    auto callback = [path, flags, fi, promise, ctx](Napi::Env env, Napi::Function jsCallback) {
        try {
            fprintf(stderr, "[C++] fuse3_open callback: getting operations object\n");
            fflush(stderr);

            Napi::Object ops = ctx->operations.Value();
            fprintf(stderr, "[C++] fuse3_open callback: got operations, getting open function\n");
            fflush(stderr);

            Napi::Value open = ops.Get("open");

            if (!open.IsFunction()) {
                fprintf(stderr, "[C++] fuse3_open callback: open is not a function!\n");
                fflush(stderr);
                promise->set_value(-ENOSYS);
                return;
            }

            fprintf(stderr, "[C++] fuse3_open callback: creating result callback\n");
            fflush(stderr);

            auto resultCb = Napi::Function::New(env, [promise, fi](const Napi::CallbackInfo& info) {
                fprintf(stderr, "[C++] fuse3_open resultCb called with %d args\n", (int)info.Length());
                fflush(stderr);

                if (info.Length() > 0 && info[0].IsNumber()) {
                    int result = info[0].As<Napi::Number>().Int32Value();
                    // Force direct_io to bypass caching and ensure read is called
                    fi->direct_io = 1;
                    fprintf(stderr, "[C++] fuse3_open: set direct_io=1, result=%d\n", result);
                    fflush(stderr);
                    promise->set_value(result);
                } else {
                    fi->direct_io = 1;
                    fprintf(stderr, "[C++] fuse3_open: set direct_io=1 (default path)\n");
                    fflush(stderr);
                    promise->set_value(0);
                }
            });

            fprintf(stderr, "[C++] fuse3_open callback: calling JS open function\n");
            fflush(stderr);

            open.As<Napi::Function>().Call(ops, {
                Napi::String::New(env, path),
                Napi::Number::New(env, flags),
                resultCb
            });

            fprintf(stderr, "[C++] fuse3_open callback: JS open function called\n");
            fflush(stderr);

        } catch (const Napi::Error& e) {
            std::string msg = e.Message();
            fprintf(stderr, "[C++] fuse3_open callback: Napi::Error: %s\n", msg.c_str());
            fflush(stderr);
            promise->set_value(-EIO);
        } catch (const std::exception& e) {
            fprintf(stderr, "[C++] fuse3_open callback: std::exception: %s\n", e.what());
            fflush(stderr);
            promise->set_value(-EIO);
        } catch (...) {
            fprintf(stderr, "[C++] fuse3_open callback: unknown exception\n");
            fflush(stderr);
            promise->set_value(-EIO);
        }
    };

    ctx->tsfn.BlockingCall(callback);
    int result = future.get();
    fprintf(stderr, "[C++] fuse3_open: returning %d\n", result);
    fflush(stderr);
    return result;
}

int fuse3_read(const char *path, char *buf, size_t size, off_t offset,
               struct fuse_file_info *fi) {
    fprintf(stderr, "[C++] fuse3_read called for path: %s, size: %zu, offset: %ld\n", path, size, offset);
    fflush(stderr);

    FuseContext* ctx = GetContextFromPath(path);
    if (!ctx) {
        fprintf(stderr, "[C++] fuse3_read: no context!\n");
        fflush(stderr);
        return -EIO;
    }

    auto promise = std::make_shared<std::promise<int>>();
    std::future<int> future = promise->get_future();

    fprintf(stderr, "[C++] fuse3_read: calling ThreadSafeFunction\n");
    fflush(stderr);
    
    auto callback = [path, buf, size, offset, fi, promise, ctx](Napi::Env env, Napi::Function jsCallback) {
        try {
            Napi::Object ops = ctx->operations.Value();
            Napi::Value read = ops.Get("read");
            
            if (!read.IsFunction()) {
                promise->set_value(-ENOSYS);
                return;
            }
            
            auto resultCb = Napi::Function::New(env, [buf, size, promise](const Napi::CallbackInfo& info) {
                if (info.Length() < 1) {
                    promise->set_value(-EINVAL);
                    return;
                }

                int result = info[0].As<Napi::Number>().Int32Value();
                if (result < 0) {
                    // Error case - negative error code
                    promise->set_value(result);
                    return;
                }

                // Success case: result is bytesRead, second arg is buffer
                if (info.Length() >= 2 && info[1].IsBuffer()) {
                    Napi::Buffer<char> buffer = info[1].As<Napi::Buffer<char>>();
                    size_t bytesRead = std::min((size_t)result, size);  // Use actual bytesRead from JS
                    memcpy(buf, buffer.Data(), bytesRead);
                    promise->set_value(bytesRead);
                } else {
                    // EOF case - just return the bytesRead (should be 0)
                    promise->set_value(result);
                }
            });
            
            Napi::Buffer<char> buffer = Napi::Buffer<char>::New(env, size);
            
            read.As<Napi::Function>().Call(ops, {
                Napi::String::New(env, path),
                Napi::Number::New(env, fi->fh),
                buffer,
                Napi::Number::New(env, size),
                Napi::Number::New(env, offset),
                resultCb
            });
            
        } catch (...) {
            promise->set_value(-EIO);
        }
    };
    
    ctx->tsfn.BlockingCall(callback);
    return future.get();
}

int fuse3_write(const char *path, const char *buf, size_t size, off_t offset,
                struct fuse_file_info *fi) {
    FuseContext* ctx = GetContextFromPath(path);
    if (!ctx) return -EIO;
    
    auto promise = std::make_shared<std::promise<int>>();
    std::future<int> future = promise->get_future();
    
    auto callback = [path, buf, size, offset, fi, promise, ctx](Napi::Env env, Napi::Function jsCallback) {
        try {
            Napi::Object ops = ctx->operations.Value();
            Napi::Value write = ops.Get("write");
            
            if (!write.IsFunction()) {
                promise->set_value(-ENOSYS);
                return;
            }
            
            auto resultCb = Napi::Function::New(env, [promise](const Napi::CallbackInfo& info) {
                if (info.Length() < 1) {
                    promise->set_value(-EINVAL);
                    return;
                }
                
                int result = info[0].As<Napi::Number>().Int32Value();
                promise->set_value(result);
            });
            
            Napi::Buffer<char> buffer = Napi::Buffer<char>::Copy(env, buf, size);
            
            write.As<Napi::Function>().Call(ops, {
                Napi::String::New(env, path),
                Napi::Number::New(env, fi->fh),
                buffer,
                Napi::Number::New(env, size),
                Napi::Number::New(env, offset),
                resultCb
            });
            
        } catch (...) {
            promise->set_value(-EIO);
        }
    };
    
    ctx->tsfn.BlockingCall(callback);
    return future.get();
}

// Simplified implementations for other operations
int fuse3_create(const char *path, mode_t mode, struct fuse_file_info *fi) {
    return CallJsOperation("create", path, mode);
}

int fuse3_unlink(const char *path) {
    return CallJsOperation("unlink", path);
}

int fuse3_mkdir(const char *path, mode_t mode) {
    return CallJsOperation("mkdir", path, mode);
}

int fuse3_rmdir(const char *path) {
    return CallJsOperation("rmdir", path);
}

int fuse3_rename(const char *from, const char *to, unsigned int flags) {
    return CallJsOperation("rename", from, to);
}

int fuse3_chmod(const char *path, mode_t mode, struct fuse_file_info *fi) {
    return CallJsOperation("chmod", path, mode);
}

int fuse3_chown(const char *path, uid_t uid, gid_t gid, struct fuse_file_info *fi) {
    return CallJsOperation("chown", path, uid, gid);
}

int fuse3_truncate(const char *path, off_t size, struct fuse_file_info *fi) {
    return CallJsOperation("truncate", path, size);
}

int fuse3_utimens(const char *path, const struct timespec ts[2], struct fuse_file_info *fi) {
    return CallJsOperation("utimens", path, ts[0].tv_sec, ts[1].tv_sec);
}

int fuse3_release(const char *path, struct fuse_file_info *fi) {
    FuseContext* ctx = GetContextFromPath(path);
    if (!ctx) return -EIO;

    auto promise = std::make_shared<std::promise<int>>();
    std::future<int> future = promise->get_future();

    uint64_t fh = fi->fh;

    auto callback = [path, fh, promise, ctx](Napi::Env env, Napi::Function jsCallback) {
        try {
            Napi::Object ops = ctx->operations.Value();
            Napi::Value release = ops.Get("release");

            if (!release.IsFunction()) {
                promise->set_value(0);  // Not implementing release is OK
                return;
            }

            auto resultCb = Napi::Function::New(env, [promise](const Napi::CallbackInfo& info) {
                if (info.Length() > 0 && info[0].IsNumber()) {
                    promise->set_value(info[0].As<Napi::Number>().Int32Value());
                } else {
                    promise->set_value(0);
                }
            });

            release.As<Napi::Function>().Call(ops, {
                Napi::String::New(env, path),
                Napi::Number::New(env, static_cast<double>(fh)),
                resultCb
            });

        } catch (...) {
            promise->set_value(-EIO);
        }
    };

    ctx->tsfn.BlockingCall(callback);
    return future.get();
}

int fuse3_fsync(const char *path, int isdatasync, struct fuse_file_info *fi) {
    return CallJsOperation("fsync", path, isdatasync, fi->fh);
}

int fuse3_flush(const char *path, struct fuse_file_info *fi) {
    return CallJsOperation("flush", path, fi->fh);
}

int fuse3_access(const char *path, int mask) {
    return CallJsOperation("access", path, mask);
}

int fuse3_statfs(const char *path, struct statvfs *stbuf) {
    // Basic implementation - can be expanded
    memset(stbuf, 0, sizeof(struct statvfs));
    stbuf->f_bsize = 4096;
    stbuf->f_blocks = 1000000;
    stbuf->f_bfree = 500000;
    stbuf->f_bavail = 500000;
    return 0;
}