import SwiftUI

struct ExerciseEditorView: View {
    @Binding var exercise: ExerciseEntry

    var body: some View {
        NavigationLink {
            ExerciseSetEditorView(exercise: $exercise)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(exercise.name)
                    .font(.headline)

                if exercise.sets.isEmpty {
                    Text(exercise.notes.isEmpty ? "Cardio / observação" : exercise.notes)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text(summaryText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 6)
        }
    }

    private var summaryText: String {
        let warmups = exercise.sets.filter { $0.type == .warmup }.count
        let working = exercise.sets.filter { $0.type == .working }.count
        let bestWeight = exercise.sets
            .filter { $0.type == .working }
            .compactMap { Double($0.weightText.replacingOccurrences(of: ",", with: ".")) }
            .max() ?? 0

        return "\(warmups) aquecimento(s) • \(working) série(s) válida(s) • melhor: \(String(format: "%.1f", bestWeight))kg"
    }
}

struct ExerciseSetEditorView: View {
    @Binding var exercise: ExerciseEntry
    @State private var draft: ExerciseEntry
    @State private var setToDelete: UUID?

    init(exercise: Binding<ExerciseEntry>) {
        self._exercise = exercise
        self._draft = State(initialValue: exercise.wrappedValue)
    }

    var body: some View {
        Form {
            Section("Exercício") {
                Text(draft.name)
                    .font(.headline)

                TextField("Observação", text: $draft.notes, axis: .vertical)
            }

            Section("Séries") {
                if draft.sets.isEmpty {
                    Text("Nenhuma série cadastrada.")
                        .foregroundStyle(.secondary)
                }

                ForEach(draft.sets) { set in
                    if let setBinding = bindingForSet(id: set.id) {
                        VStack(alignment: .leading, spacing: 10) {
                            Picker("Tipo", selection: setBinding.type) {
                                Text("Aquecimento").tag(SetType.warmup)
                                Text("Série válida").tag(SetType.working)
                            }
                            .pickerStyle(.segmented)

                            HStack(spacing: 10) {
                                Text(labelForSet(id: set.id))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .frame(width: 100, alignment: .leading)

                                Stepper("\(setBinding.reps.wrappedValue) reps", value: setBinding.reps, in: 1...50)

                                TextField("Kg", text: setBinding.weightText)
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.center)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(width: 80)
                            }

                            Button(role: .destructive) {
                                setToDelete = set.id
                            } label: {
                                Label("Excluir esta série", systemImage: "trash")
                                    .font(.caption)
                            }
                        }
                        .padding(.vertical, 6)
                    }
                }

                Button {
                    addWorkingSet()
                } label: {
                    Label("Adicionar série válida", systemImage: "plus.circle")
                }

                Button {
                    addWarmupSet()
                } label: {
                    Label("Adicionar aquecimento", systemImage: "flame")
                }
            }
        }
        .navigationTitle(draft.name)
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear {
            exercise = draft
        }
        .alert("Excluir série?", isPresented: Binding(
            get: { setToDelete != nil },
            set: { if !$0 { setToDelete = nil } }
        )) {
            Button("Cancelar", role: .cancel) {
                setToDelete = nil
            }

            Button("Excluir", role: .destructive) {
                if let id = setToDelete {
                    deleteSet(id: id)
                }

                setToDelete = nil
            }
        } message: {
            Text("Tem certeza que deseja excluir esta série?")
        }
    }

    private func bindingForSet(id: UUID) -> Binding<SetEntry>? {
        guard let index = draft.sets.firstIndex(where: { $0.id == id }) else {
            return nil
        }

        return Binding<SetEntry>(
            get: {
                draft.sets[index]
            },
            set: { newValue in
                if let currentIndex = draft.sets.firstIndex(where: { $0.id == id }) {
                    draft.sets[currentIndex] = newValue
                }
            }
        )
    }

    private func labelForSet(id: UUID) -> String {
        guard let targetSet = draft.sets.first(where: { $0.id == id }) else {
            return "Série"
        }

        if targetSet.type == .warmup {
            return "Aquecimento"
        }

        var count = 0

        for current in draft.sets {
            if current.type == .working {
                count += 1
            }

            if current.id == id {
                break
            }
        }

        return "Série \(count)"
    }

    private func addWorkingSet() {
        draft.sets.append(SetEntry(type: .working, reps: 8, weightText: ""))
    }

    private func addWarmupSet() {
        draft.sets.append(SetEntry(type: .warmup, reps: 12, weightText: ""))
    }

    private func deleteSet(id: UUID) {
        guard let index = draft.sets.firstIndex(where: { $0.id == id }) else {
            return
        }

        draft.sets.remove(at: index)
    }
}
