#include <napi.h>
#include <fuse3/fuse.h>
#include <fuse3/fuse_lowlevel.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <string.h>
#include <errno.h>
#include <memory>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <unordered_map>
#include <future>

// FUSE operation callback context
struct FuseContext {
    Napi::ThreadSafeFunction tsfn;
    Napi::ObjectReference operations;
    std::string mountPoint;
    struct fuse *fuse;
    std::thread *fuseThread;
    bool mounted;
};

// Global map to store contexts by mount point
std::unordered_map<std::string, std::unique_ptr<FuseContext>> g_contexts;
std::mutex g_contexts_mutex;

// Forward declarations - these are defined in fuse3_operations.cc
extern int fuse3_getattr(const char *path, struct stat *stbuf, struct fuse_file_info *fi);
extern int fuse3_readdir(const char *path, void *buf, fuse_fill_dir_t filler,
                         off_t offset, struct fuse_file_info *fi, enum fuse_readdir_flags flags);
extern int fuse3_open(const char *path, struct fuse_file_info *fi);
extern int fuse3_read(const char *path, char *buf, size_t size, off_t offset,
                      struct fuse_file_info *fi);
extern int fuse3_write(const char *path, const char *buf, size_t size, off_t offset,
                       struct fuse_file_info *fi);
extern int fuse3_create(const char *path, mode_t mode, struct fuse_file_info *fi);
extern int fuse3_unlink(const char *path);
extern int fuse3_mkdir(const char *path, mode_t mode);
extern int fuse3_rmdir(const char *path);
extern int fuse3_rename(const char *from, const char *to, unsigned int flags);
extern int fuse3_chmod(const char *path, mode_t mode, struct fuse_file_info *fi);
extern int fuse3_chown(const char *path, uid_t uid, gid_t gid, struct fuse_file_info *fi);
extern int fuse3_truncate(const char *path, off_t size, struct fuse_file_info *fi);
extern int fuse3_utimens(const char *path, const struct timespec ts[2], struct fuse_file_info *fi);
extern int fuse3_release(const char *path, struct fuse_file_info *fi);
extern int fuse3_fsync(const char *path, int isdatasync, struct fuse_file_info *fi);
extern int fuse3_flush(const char *path, struct fuse_file_info *fi);
extern int fuse3_access(const char *path, int mask);
extern int fuse3_statfs(const char *path, struct statvfs *stbuf);

// FUSE operations structure - initialize all fields to NULL first
static struct fuse_operations fuse3_ops = {};

// Initialize operations in a function to avoid initialization order issues
static void init_fuse_operations() {
    fuse3_ops.getattr = fuse3_getattr;
    fuse3_ops.readdir = fuse3_readdir;
    fuse3_ops.open = fuse3_open;
    fuse3_ops.read = fuse3_read;
    fuse3_ops.write = fuse3_write;
    fuse3_ops.create = fuse3_create;
    fuse3_ops.unlink = fuse3_unlink;
    fuse3_ops.mkdir = fuse3_mkdir;
    fuse3_ops.rmdir = fuse3_rmdir;
    fuse3_ops.rename = fuse3_rename;
    fuse3_ops.chmod = fuse3_chmod;
    fuse3_ops.chown = fuse3_chown;
    fuse3_ops.truncate = fuse3_truncate;
    fuse3_ops.utimens = fuse3_utimens;
    fuse3_ops.release = fuse3_release;
    fuse3_ops.fsync = fuse3_fsync;
    fuse3_ops.flush = fuse3_flush;
    fuse3_ops.access = fuse3_access;
    fuse3_ops.statfs = fuse3_statfs;
}

// Helper to get context from path
FuseContext* GetContextFromPath(const char* path) {
    std::lock_guard<std::mutex> lock(g_contexts_mutex);
    
    // For now, we'll use a simple approach - return the first context
    // In a real implementation, you might want to match based on mount point
    if (!g_contexts.empty()) {
        return g_contexts.begin()->second.get();
    }
    return nullptr;
}

// JavaScript callback structure
struct JsCallback {
    std::string operation;
    std::string path;
    std::promise<Napi::Object> promise;
    Napi::Reference<Napi::Object> dataRef;
};

// Main FUSE class
class Fuse3 : public Napi::ObjectWrap<Fuse3> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    Fuse3(const Napi::CallbackInfo& info);
    ~Fuse3();

private:
    static Napi::FunctionReference constructor;
    
    Napi::Value Mount(const Napi::CallbackInfo& info);
    Napi::Value Unmount(const Napi::CallbackInfo& info);
    Napi::Value IsMounted(const Napi::CallbackInfo& info);
    
    std::unique_ptr<FuseContext> context_;
};

Napi::FunctionReference Fuse3::constructor;

Napi::Object Fuse3::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Fuse3", {
        InstanceMethod("mount", &Fuse3::Mount),
        InstanceMethod("unmount", &Fuse3::Unmount),
        InstanceMethod("isMounted", &Fuse3::IsMounted),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("Fuse3", func);
    
    // Export error constants
    exports.Set("EPERM", Napi::Number::New(env, -EPERM));
    exports.Set("ENOENT", Napi::Number::New(env, -ENOENT));
    exports.Set("EIO", Napi::Number::New(env, -EIO));
    exports.Set("EACCES", Napi::Number::New(env, -EACCES));
    exports.Set("EEXIST", Napi::Number::New(env, -EEXIST));
    exports.Set("ENOTDIR", Napi::Number::New(env, -ENOTDIR));
    exports.Set("EISDIR", Napi::Number::New(env, -EISDIR));
    exports.Set("EINVAL", Napi::Number::New(env, -EINVAL));
    exports.Set("ENOSPC", Napi::Number::New(env, -ENOSPC));
    exports.Set("EROFS", Napi::Number::New(env, -EROFS));
    exports.Set("EBUSY", Napi::Number::New(env, -EBUSY));
    exports.Set("ENOTEMPTY", Napi::Number::New(env, -ENOTEMPTY));

    return exports;
}

Fuse3::Fuse3(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Fuse3>(info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "Arguments: (mountPoint: string, operations: object)")
            .ThrowAsJavaScriptException();
        return;
    }
    
    context_ = std::make_unique<FuseContext>();
    context_->mountPoint = info[0].As<Napi::String>().Utf8Value();
    context_->operations = Napi::Persistent(info[1].As<Napi::Object>());
    context_->mounted = false;
    context_->fuse = nullptr;
    context_->fuseThread = nullptr;
}

Fuse3::~Fuse3() {
    // Context may have been moved to global map, skip cleanup here
    // Unmount() should be called explicitly before destruction
}

Napi::Value Fuse3::Mount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (context_->mounted) {
        Napi::Error::New(env, "Already mounted").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    // Create thread-safe function for callbacks
    context_->tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),  // JavaScript callback function
        "FUSE3Callback",                // Resource name
        0,                              // Unlimited queue
        1                               // One thread
    );

    // Save mount point before moving context
    std::string mountPoint = context_->mountPoint;

    // Store context in global map
    {
        std::lock_guard<std::mutex> lock(g_contexts_mutex);
        g_contexts[mountPoint] = std::move(context_);
    }

    // Get context back from map
    FuseContext* ctx = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_contexts_mutex);
        ctx = g_contexts[mountPoint].get();
    }
    
    // Create FUSE thread
    ctx->fuseThread = new std::thread([ctx]() {
        // Initialize FUSE operations
        init_fuse_operations();
        
        // FUSE arguments - minimal setup for FUSE3
        struct fuse_args args = FUSE_ARGS_INIT(0, nullptr);
        fuse_opt_add_arg(&args, "fuse3_napi"); // Program name
        
        // Create FUSE instance
        ctx->fuse = fuse_new(&args, &fuse3_ops, sizeof(fuse3_ops), nullptr);
        if (!ctx->fuse) {
            ctx->tsfn.BlockingCall([](Napi::Env env, Napi::Function callback) {
                callback.Call({Napi::String::New(env, "Failed to create FUSE instance")});
            });
            fuse_opt_free_args(&args);
            return;
        }
        
        // Mount
        if (fuse_mount(ctx->fuse, ctx->mountPoint.c_str()) != 0) {
            ctx->tsfn.BlockingCall([](Napi::Env env, Napi::Function callback) {
                callback.Call({Napi::String::New(env, "Failed to mount FUSE filesystem")});
            });
            fuse_destroy(ctx->fuse);
            fuse_opt_free_args(&args);
            return;
        }
        
        ctx->mounted = true;
        
        // Notify mount success
        ctx->tsfn.BlockingCall([](Napi::Env env, Napi::Function callback) {
            callback.Call({env.Null()});
        });
        
        // Run FUSE main loop
        fuse_loop(ctx->fuse);
        
        // Cleanup
        fuse_unmount(ctx->fuse);
        fuse_destroy(ctx->fuse);
        fuse_opt_free_args(&args);
        
        ctx->mounted = false;
    });
    
    return env.Undefined();
}

Napi::Value Fuse3::Unmount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Find context in global map - need to iterate since context_ was moved
    FuseContext* ctx = nullptr;
    std::string mountPoint;
    {
        std::lock_guard<std::mutex> lock(g_contexts_mutex);
        // Since we only expect one mounted filesystem, get the first one
        if (!g_contexts.empty()) {
            auto it = g_contexts.begin();
            ctx = it->second.get();
            mountPoint = it->first;
        }
    }

    if (!ctx || !ctx->mounted) {
        Napi::Error::New(env, "Not mounted").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Signal FUSE to exit
    if (ctx->fuse) {
        fuse_exit(ctx->fuse);
    }

    // Wait for thread to finish
    if (ctx->fuseThread) {
        ctx->fuseThread->join();
        delete ctx->fuseThread;
        ctx->fuseThread = nullptr;
    }

    // Remove from global map
    {
        std::lock_guard<std::mutex> lock(g_contexts_mutex);
        g_contexts.erase(mountPoint);
    }

    return env.Undefined();
}

Napi::Value Fuse3::IsMounted(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::lock_guard<std::mutex> lock(g_contexts_mutex);
    auto it = g_contexts.find(context_->mountPoint);
    if (it != g_contexts.end() && it->second->mounted) {
        return Napi::Boolean::New(env, true);
    }
    
    return Napi::Boolean::New(env, false);
}

// Initialize the addon
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Initialize FUSE operations structure
    init_fuse_operations();
    return Fuse3::Init(env, exports);
}

NODE_API_MODULE(fuse3_napi, Init)