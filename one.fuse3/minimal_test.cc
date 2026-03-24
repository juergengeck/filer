#include <napi.h>

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("test", Napi::String::New(env, "Hello from FUSE3 N-API"));
    exports.Set("version", Napi::Number::New(env, 1));
    return exports;
}

NODE_API_MODULE(minimal_test, Init)