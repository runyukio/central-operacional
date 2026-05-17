import Foundation
import SwiftUI
import UIKit

struct ActivityView: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

enum FileExportHelper {
    static func createFile(name: String, content: String) -> URL {
        createTextFile(name: name, content: content)
    }

    static func createTextFile(name: String, content: String) -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? content.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    static func createDataFile(name: String, data: Data) -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? data.write(to: url, options: .atomic)
        return url
    }
}
