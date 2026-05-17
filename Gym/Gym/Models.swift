import Foundation

struct WorkoutSession: Identifiable, Codable, Equatable {
    var id = UUID()
    var date: Date
    var title: String
    var exercises: [ExerciseEntry]
}

struct ExerciseEntry: Identifiable, Codable, Equatable {
    var id = UUID()
    var name: String
    var sets: [SetEntry]
    var notes: String
}

struct SetEntry: Identifiable, Codable, Equatable {
    var id = UUID()
    var type: SetType
    var reps: Int
    var weightText: String
}

enum SetType: String, Codable, CaseIterable, Equatable {
    case warmup = "Aquecimento"
    case working = "Trabalho"
}
