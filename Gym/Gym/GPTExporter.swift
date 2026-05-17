import Foundation

enum GPTExporter {
    static func export(workout: WorkoutSession) -> String {
        WorkoutExportService.gptText(for: workout)
    }

    static func exportAllForGPT(workouts: [WorkoutSession]) -> String {
        WorkoutExportService.gptText(for: workouts)
    }

    static func exportAllAsCSV(workouts: [WorkoutSession]) -> String {
        WorkoutExportService.csv(for: workouts)
    }
}
