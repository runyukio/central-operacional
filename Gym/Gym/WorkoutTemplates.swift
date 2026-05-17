import Foundation

struct WorkoutTemplate: Identifiable, Codable, Equatable {
    var id = UUID()
    var title: String
    var exercises: [String]
}

enum WorkoutDefaults {
    static let templates: [WorkoutTemplate] = [
        WorkoutTemplate(title: "Perna / Abdominal", exercises: [
            "Agachamento livre", "Leg press 45", "Cadeira flexora", "Mesa flexora",
            "Cadeira extensora", "Cadeira adutora", "Cadeira abdutora",
            "Panturrilha no leg press 90", "Elevação pélvica na máquina",
            "Panturrilha na máquina em pé", "Flexão da lombar na máquina",
            "Abdominal infra no banco", "Cardio - escada 20 min"
        ]),
        WorkoutTemplate(title: "Peito / Tríceps / Trapézio / Abdominal", exercises: [
            "Peck deck", "Supino inclinado na máquina ou halter", "Supino reto na máquina",
            "Supino declinado máquina ou polia", "Tríceps unilateral na polia",
            "Tríceps coice na polia", "Tríceps rosca francesa na polia",
            "Tríceps na barra W", "Encolhimento de trapézio na polia",
            "Abdominal na polia", "Cardio"
        ]),
        WorkoutTemplate(title: "Costas / Ombro / Bíceps", exercises: [
            "Puxada alta frente", "Puxada articulada", "Remada baixa",
            "Remada curvada ou máquina", "Remada unilateral", "Pulldown na polia",
            "Desenvolvimento de ombro máquina ou halter", "Elevação lateral",
            "Crucifixo inverso máquina", "Rosca direta barra W",
            "Rosca alternada halter", "Rosca martelo", "Cardio"
        ])
    ]

    static let extraExercises: [String] = [
        "Abdominal máquina", "Abdominal na polia", "Abdominal infra no banco",
        "Agachamento livre", "Cadeira abdutora", "Cadeira adutora", "Cadeira extensora",
        "Cadeira flexora", "Cardio", "Cardio - escada 20 min", "Crucifixo inverso máquina",
        "Desenvolvimento de ombro máquina ou halter", "Elevação lateral",
        "Elevação pélvica na máquina", "Encolhimento de trapézio na polia",
        "Flexão da lombar na máquina", "Leg press 45", "Mesa flexora",
        "Panturrilha na máquina em pé", "Panturrilha no leg press 90", "Peck deck",
        "Pulldown na polia", "Puxada alta frente", "Puxada articulada", "Remada baixa",
        "Remada curvada ou máquina", "Remada unilateral", "Rosca alternada halter",
        "Rosca direta barra W", "Rosca martelo", "Rosca Scott máquina ou banco",
        "Supino declinado máquina ou polia", "Supino inclinado na máquina ou halter",
        "Supino reto na máquina", "Tríceps coice na polia", "Tríceps na barra W",
        "Tríceps rosca francesa na polia", "Tríceps unilateral na polia"
    ]

    static func defaultSets(for exerciseName: String) -> [SetEntry] {
        if exerciseName.lowercased().contains("cardio") { return [] }
        return [
            SetEntry(type: .warmup, reps: 12, weightText: ""),
            SetEntry(type: .working, reps: 8, weightText: ""),
            SetEntry(type: .working, reps: 8, weightText: ""),
            SetEntry(type: .working, reps: 8, weightText: "")
        ]
    }

    static func defaultNote(for exerciseName: String) -> String {
        exerciseName.lowercased().contains("cardio") ? "Registrar tempo, intensidade e observação." : ""
    }

    static func buildWorkout(from template: WorkoutTemplate, date: Date) -> WorkoutSession {
        let exercises = template.exercises.map {
            ExerciseEntry(name: $0, sets: defaultSets(for: $0), notes: defaultNote(for: $0))
        }
        return WorkoutSession(date: date, title: template.title, exercises: exercises)
    }
}
