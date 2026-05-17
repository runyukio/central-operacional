import Foundation

struct WorkoutExportRow: Equatable {
    let date: String
    let workout: String
    let exercise: String
    let setType: String
    let setNumber: Int
    let weight: String
    let reps: Int
    let observation: String

    var values: [String] {
        [
            date,
            workout,
            exercise,
            setType,
            "\(setNumber)",
            weight,
            "\(reps)",
            observation
        ]
    }
}

enum WorkoutExportService {
    static let headers = [
        "Data",
        "Treino",
        "Exercicio",
        "TipoSerie",
        "Serie",
        "Peso",
        "Reps",
        "Observacao"
    ]

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "pt_BR")
        formatter.dateFormat = "dd/MM/yyyy"
        return formatter
    }()

    static func rows(for workout: WorkoutSession) -> [WorkoutExportRow] {
        workout.exercises.flatMap { exercise -> [WorkoutExportRow] in
            var workingSetNumber = 1

            return exercise.sets.map { set in
                let number: Int
                let type: String

                switch set.type {
                case .warmup:
                    number = 0
                    type = "Aquecimento"
                case .working:
                    number = workingSetNumber
                    workingSetNumber += 1
                    type = "Valida"
                }

                return WorkoutExportRow(
                    date: dateFormatter.string(from: workout.date),
                    workout: workout.title,
                    exercise: exercise.name,
                    setType: type,
                    setNumber: number,
                    weight: set.weightText.trimmingCharacters(in: .whitespacesAndNewlines),
                    reps: set.reps,
                    observation: exercise.notes.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            }
        }
    }

    static func rows(for workouts: [WorkoutSession]) -> [WorkoutExportRow] {
        workouts
            .sorted { lhs, rhs in
                if lhs.date == rhs.date { return lhs.title < rhs.title }
                return lhs.date < rhs.date
            }
            .flatMap { rows(for: $0) }
    }

    static func csv(for workout: WorkoutSession) -> String {
        csv(from: rows(for: workout))
    }

    static func csv(for workouts: [WorkoutSession]) -> String {
        csv(from: rows(for: workouts))
    }

    static func gptText(for workout: WorkoutSession) -> String {
        var text = """
        TREINO: \(workout.title)
        DATA: \(dateFormatter.string(from: workout.date))
        """

        var observations: [String] = []

        for exercise in workout.exercises {
            text += "\n\n\(exercise.name)"

            if exercise.sets.isEmpty {
                if !exercise.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    observations.append("\(exercise.name): \(exercise.notes.trimmingCharacters(in: .whitespacesAndNewlines))")
                }
                continue
            }

            var workingSetNumber = 1

            for set in exercise.sets {
                let label: String
                switch set.type {
                case .warmup:
                    label = "Aquecimento"
                case .working:
                    label = "Série \(workingSetNumber)"
                    workingSetNumber += 1
                }

                text += "\n\(label): \(weightForGPT(set.weightText)) x \(set.reps)"
            }

            let note = exercise.notes.trimmingCharacters(in: .whitespacesAndNewlines)
            if !note.isEmpty {
                observations.append("\(exercise.name): \(note)")
            }
        }

        text += "\n\nOBS:"
        if !observations.isEmpty {
            text += "\n" + observations.map { "- \($0)" }.joined(separator: "\n")
        }

        return text
    }

    static func chatGPTClipboardText(for workout: WorkoutSession) -> String {
        """
        ==============================
        TREINO EXECUTADO
        ==============================

        \(gptText(for: workout))

        ==============================
        INSTRUÇÃO PARA ANÁLISE
        ==============================

        Analise meu treino de hoje usando:
        - meu treino oficial anexado
        - meu histórico anexado
        - meus treinos anteriores

        Compare com o último treino equivalente da mesma divisão e avalie:
        - evolução
        - performance
        - volume
        - progressão
        - execução
        - fadiga
        - excesso ou falta de estímulo

        No final, monte o próximo treino equivalente da MESMA divisão executada.

        Exemplo:
        - Se o treino atual for Pull, gerar o próximo Pull
        - Se o treino atual for Push, gerar o próximo Push
        - Se o treino atual for Upper, gerar o próximo Upper
        - Se o treino atual for Lower, gerar o próximo Lower
        - Se o treino atual for Legs, gerar o próximo Legs

        Importante:
        Não gerar o treino do próximo dia da semana.
        Gerar sempre o próximo treino equivalente da mesma categoria.

        O próximo treino deve:
        - manter os mesmos exercícios principais do treino oficial
        - respeitar a estrutura oficial da divisão
        - sugerir progressão inteligente baseada no histórico
        - ajustar carga/reps conforme performance anterior
        - considerar fadiga, execução e volume do treino atual

        Formato obrigatório do próximo treino:
        - Exercício
        - Peso sugerido
        - Reps alvo
        - Estratégia
        - Técnica
        - Observação

        Regras da análise:
        - Não alterar a estrutura oficial sem necessidade clara
        - Priorizar progressão inteligente
        - Comparar com histórico real
        - Identificar evolução, regressão ou estagnação
        - Sugerir aumento, manutenção ou redução de carga quando apropriado
        - Considerar execução e fadiga descritas nas observações
        - Explicar de forma objetiva e prática
        """
    }

    static func gptText(for workouts: [WorkoutSession]) -> String {
        workouts
            .sorted { lhs, rhs in
                if lhs.date == rhs.date { return lhs.title < rhs.title }
                return lhs.date < rhs.date
            }
            .map { gptText(for: $0) }
            .joined(separator: "\n\n==============================\n\n")
    }

    private static func csv(from rows: [WorkoutExportRow]) -> String {
        var csv = headers.joined(separator: ",") + "\n"
        csv += rows.map { csvLine($0.values) }.joined()
        return csv
    }

    private static func csvLine(_ values: [String]) -> String {
        values.map { csvField($0) }.joined(separator: ",") + "\n"
    }

    private static func csvField(_ value: String) -> String {
        let needsQuotes = value.contains(",") || value.contains("\"") || value.contains("\n") || value.contains("\r")
        guard needsQuotes else { return value }

        return "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
    }

    private static func weightForGPT(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "0kg" }

        if trimmed.lowercased().contains("kg") {
            return trimmed
        }

        return "\(trimmed)kg"
    }
}
