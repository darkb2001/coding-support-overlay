#import <Cocoa/Cocoa.h>
#import <node_api.h>

// Apply a legacy capture hint to process windows. ScreenCaptureKit may ignore it.
napi_value HideFromCapture(napi_env env, napi_callback_info info) {
    @autoreleasepool {
        NSArray *windows = [[NSApplication sharedApplication] windows];
        
        for (NSWindow *window in windows) {
            [window setSharingType:NSWindowSharingNone];
            NSLog(@"[HideCapture] Window %ld sharing hint set to none", (long)[window windowNumber]);
        }
        
        NSLog(@"[HideCapture] Hint applied to %lu windows; capture exclusion is not guaranteed", (unsigned long)[windows count]);
        
        napi_value result;
        napi_get_boolean(env, true, &result);
        return result;
    }
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, "hideFromCapture", NAPI_AUTO_LENGTH, HideFromCapture, NULL, &fn);
    napi_set_named_property(env, exports, "hideFromCapture", fn);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init);
