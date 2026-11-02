#!/usr/bin/swift
import Cocoa

// Hide all windows of the current app from screen capture
func hideWindowsFromCapture() {
    guard let app = NSApplication.shared as? NSApplication else {
        print("[Swift] Could not get NSApplication")
        exit(1)
    }
    
    let windows = app.windows
    print("[Swift] Found \(windows.count) windows")
    
    for (index, window) in windows.enumerated() {
        window.sharingType = .none  // NSWindowSharingNone
        print("[Swift] Window \(index) (ID: \(window.windowNumber)) set to NSWindowSharingNone")
    }
    
    print("[Swift] ✓ All windows hidden from screen capture")
}

hideWindowsFromCapture()
