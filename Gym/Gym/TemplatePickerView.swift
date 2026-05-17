import SwiftUI

struct TemplatePickerView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var workoutStore: WorkoutStore
    @ObservedObject var templateStore: TemplateStore
    @State private var selectedDate = Date()

    var body: some View {
        NavigationStack {
            List {
                Section("Data do treino") {
                    DatePicker("Escolher data", selection: $selectedDate, displayedComponents: .date)
                }
                Section("Templates") {
                    ForEach(templateStore.templates) { template in
                        Button {
                            let workout = WorkoutDefaults.buildWorkout(from: template, date: selectedDate)
                            workoutStore.addWorkout(workout)
                            templateStore.addExercisesToCatalog(template.exercises)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(template.title).font(.headline)
                                Text("\(template.exercises.count) exercícios").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Escolher treino")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
            }
        }
    }
}
