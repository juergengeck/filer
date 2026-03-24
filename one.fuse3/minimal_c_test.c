#include <node_api.h>

napi_value Init(napi_env env, napi_value exports) {
    napi_value test_string;
    napi_status status = napi_create_string_utf8(env, "Hello from C API", NAPI_AUTO_LENGTH, &test_string);
    if (status != napi_ok) return NULL;
    
    status = napi_set_named_property(env, exports, "test", test_string);
    if (status != napi_ok) return NULL;
    
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)