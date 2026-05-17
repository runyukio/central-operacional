import Foundation

struct ExerciseHistoryRow: Identifiable {
    let id = UUID()
    let date: Date
    let workoutTitle: String
    let bestWeight: Double
    let totalVolume: Double
    let totalWorkingSets: Int
}

struct WeeklySummary: Identifiable {
    let id = UUID()
    let weekStart: Date
    let weekEnd: Date
    let workoutsCount: Int
    let exercisesCount: Int
    let workingSetsCount: Int
    let totalVolume: Double
}

enum WorkoutAnalytics {
    static func normalizedWeight(_ text: String) -> Double {
        Double(text.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
    }

    static func workingSets(from exercise: ExerciseEntry) -> [SetEntry] {
        exercise.sets.filter { $0.type == .working }
    }

    static func totalVolume(for exercise: ExerciseEntry) -> Double {
        workingSets(from: exercise).reduce(0) { $0 + normalizedWeight($1.weightText) * Double($1.reps) }
    }

    static func bestWeight(for exercise: ExerciseEntry) -> Double {
        workingSets(from: exercise).map { normalizedWeight($0.weightText) }.max() ?? 0
    }

    static func exerciseNames(from workouts: [WorkoutSession]) -> [String] {
        Array(Set(workouts.flatMap { $0.exercises.map { $0.name } })).sorted()
    }

    static func history(for exerciseName: String, workouts: [WorkoutSession]) -> [ExerciseHistoryRow] {
        workouts.sorted { $0.date < $1.date }.compactMap { workout in
            guard let exercise = workout.exercises.first(where: { $0.name == exerciseName }) else { return nil }
            return ExerciseHistoryRow(
                date: workout.date,
                workoutTitle: workout.title,
                bestWeight: bestWeight(for: exercise),
                totalVolume: totalVolume(for: exercise),
                totalWorkingSets: workingSets(from: exercise).count
            )
        }
    }

    static func weeklySummaries(from workouts: [WorkoutSession]) -> [WeeklySummary] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: workouts) {
            calendar.dateInterval(of: .weekOfYear, for: $0.date)?.start ?? $0.date
        }
        return grouped.map { start, items in
            let end = calendar.date(byAdding: .day, value: 6, to: start) ?? start
            let exercises = items.reduce(0) { $0 + $1.exercises.count }
            let sets = items.reduce(0) { total, workout in
                total + workout.exercises.reduce(0) { $0 + workingSets(from: $1).count }
            }
            let volume = items.reduce(0) { total, workout in
                total + workout.exercises.reduce(0) { $0 + self.totalVolume(for: $1) }
            }
            return WeeklySummary(weekStart: start, weekEnd: end, workoutsCount: items.count, exercisesCount: exercises, workingSetsCount: sets, totalVolume: volume)
        }.sorted { $0.weekStart > $1.weekStart }
    }
}
