import SwiftUI

struct AddExerciseView: View {
    @Environment(\.dismiss) private var dismiss
    let exerciseOptions: [String]
    var onSave: (ExerciseEntry) -> Void

    @State private var selectedExercise = ""
    @State private var customExercise = ""
    @State private var useCustomExercise = false
    @State private var notes = ""
    @State private var sets: [SetEntry] = [
        SetEntry(type: .warmup, reps: 12, weightText: ""),
        SetEntry(type: .working, reps: 8, weightText: ""),
        SetEntry(type: .working, reps: 8, weightText: ""),
        SetEntry(type: .working, reps: 8, weightText: "")
    ]

    private var finalExerciseName: String {
        (useCustomExercise ? customExercise : selectedExercise).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Exercício") {
                    Toggle("Criar exercício novo", isOn: $useCustomExercise)
                    if useCustomExercise {
                        TextField("Nome do exercício", text: $customExercise)
                    } else {
                        Picker("Escolher exercício", selection: $selectedExercise) {
                            Text("Selecione").tag("")
                            ForEach(exerciseOptions, id: \.self) { Text($0).tag($0) }
                        }
                    }
                    TextField("Observações", text: $notes, axis: .vertical)
                }

                Section("Séries") {
                    ForEach($sets) { $set in
                        VStack(alignment: .leading, spacing: 8) {
                            Picker("Tipo", selection: $set.type) {
                                Text("Aquecimento").tag(SetType.warmup)
                                Text("Série válida").tag(SetType.working)
                            }.pickerStyle(.segmented)

                            HStack(spacing: 10) {
                                Text(labelForSet(set))
                                    .font(.caption).foregroundStyle(.secondary)
                                    .frame(width: 100, alignment: .leading)
                                Stepper("\(set.reps) reps", value: $set.reps, in: 1...50)
                                TextField("Kg", text: $set.weightText)
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.center)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(width: 80)
                            }

                            Button(role: .destructive) {
                                deleteSet(id: set.id)
                            } label: {
                                Label("Excluir esta série", systemImage: "trash").font(.caption)
                            }
                        }.padding(.vertical, 6)
                    }

                    Button { sets.append(SetEntry(type: .working, reps: 8, weightText: "")) } label: {
                        Label("Adicionar série válida", systemImage: "plus.circle")
                    }
                    Button { sets.append(SetEntry(type: .warmup, reps: 12, weightText: "")) } label: {
                        Label("Adicionar aquecimento", systemImage: "flame")
                    }
                }
            }
            .navigationTitle("Novo exercício")
            .onAppear {
                if selectedExercise.isEmpty { selectedExercise = exerciseOptions.first ?? "" }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Salvar") {
                        onSave(ExerciseEntry(
                            name: finalExerciseName.isEmpty ? "Exercício" : finalExerciseName,
                            sets: sets,
                            notes: notes
                        ))
                        dismiss()
                    }.disabled(finalExerciseName.isEmpty)
                }
            }
        }
    }

    private func labelForSet(_ set: SetEntry) -> String {
        if set.type == .warmup { return "Aquecimento" }
        var count = 0
        for current in sets {
            if current.type == .working { count += 1 }
            if current.id == set.id { break }
        }
        return "Série \(count)"
    }

    private func deleteSet(id: UUID) {
        sets.removeAll { $0.id == id }
    }
}
