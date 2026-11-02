{
  "targets": [
    {
      "target_name": "hide_capture",
      "sources": [ "hide_capture.mm" ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "OTHER_CFLAGS": ["-x", "objective-c++", "-std=c++17"],
            "OTHER_LDFLAGS": ["-framework", "Cocoa"]
          }
        }]
      ]
    }
  ]
}
