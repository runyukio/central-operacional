import SwiftUI

struct ExerciseHistoryView: View {
    @ObservedObject var store: WorkoutStore
    @State private var selectedExercise = ""

    private var exerciseNames: [String] { WorkoutAnalytics.exerciseNames(from: store.workouts) }
    private var selectedHistory: [ExerciseHistoryRow] {
        selectedExercise.isEmpty ? [] : WorkoutAnalytics.history(for: selectedExercise, workouts: store.workouts)
    }

    var body: some View {
        NavigationStack {
            List {
                if exerciseNames.isEmpty {
                    Text("Registre treinos para ver o histórico por exercício.")
                        .foregroundStyle(.secondary)
                } else {
                    Section("Exercício") {
                        Picker("Selecionar", selection: $selectedExercise) {
                            Text("Escolha um exercício").tag("")
                            ForEach(exerciseNames, id: \.self) { Text($0).tag($0) }
                        }
                    }

                    if !selectedExercise.isEmpty {
                        Section("Resumo") {
                            let best = selectedHistory.map { $0.bestWeight }.max() ?? 0
                            let total = selectedHistory.reduce(0) { $0 + $1.totalVolume }
                            HStack { Text("Melhor carga"); Spacer(); Text("\(best, specifier: "%.1f") kg").bold() }
                            HStack { Text("Volume acumulado"); Spacer(); Text("\(total, specifier: "%.0f") kg").bold() }
                        }

                        Section("Histórico") {
                            ForEach(selectedHistory) { row in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(row.date.formatted(date: .abbreviated, time: .omitted)).font(.headline)
                                    Text(row.workoutTitle).font(.caption).foregroundStyle(.secondary)
                                    HStack {
                                        Text("Melhor: \(row.bestWeight, specifier: "%.1f") kg")
                                        Spacer()
                                        Text("Volume: \(row.totalVolume, specifier: "%.0f") kg")
                                    }.font(.subheadline)
                                }.padding(.vertical, 4)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Histórico")
            .onAppear {
                if selectedExercise.isEmpty { selectedExercise = exerciseNames.first ?? "" }
            }
        }
    }
}
