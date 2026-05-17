import SwiftUI
import UIKit

struct WorkoutDetailView: View {
    @ObservedObject var store: WorkoutStore
    @State var workout: WorkoutSession
    let exerciseOptions: [String]

    @State private var showingAddExercise = false
    @State private var copiedGPT = false
    @State private var shareURL: URL?
    @State private var showingShareSheet = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text(workout.title).font(.title2).bold()
                    DatePicker("Data", selection: $workout.date, displayedComponents: .date)
                    Button {
                        copyCurrentWorkoutForChatGPT()
                    } label: {
                        Label(copiedGPT ? "Copiado!" : "Copiar para ChatGPT", systemImage: copiedGPT ? "checkmark.circle.fill" : "doc.on.doc")
                            .frame(maxWidth: .infinity)
                    }.buttonStyle(.borderedProminent)
                }.padding(.vertical, 8)
            }

            Section("Exercícios") {
                ForEach($workout.exercises) { $exercise in
                    ExerciseEditorView(exercise: $exercise)
                }.onDelete { offsets in
                    workout.exercises.remove(atOffsets: offsets)
                    store.updateWorkout(workout)
                    copiedGPT = false
                }
            }

            Section("Exportar") {
                Button {
                    shareCurrentWorkoutCSV()
                } label: {
                    Label("Exportar CSV deste treino", systemImage: "tablecells")
                }

                Button {
                    shareFullCSV()
                } label: {
                    Label("Exportar CSV completo", systemImage: "tablecells")
                }

                Button {
                    shareCurrentWorkoutXLSX()
                } label: {
                    Label("Exportar XLSX deste treino", systemImage: "doc.badge.gearshape")
                }

                Button {
                    shareFullXLSX()
                } label: {
                    Label("Exportar XLSX completo", systemImage: "doc.badge.gearshape")
                }
            }

            Section {
                Button { showingAddExercise = true } label: {
                    Label("Adicionar exercício", systemImage: "plus.circle")
                }
                Button(role: .destructive) {
                    store.deleteWorkout(workout)
                    dismiss()
                } label: {
                    Label("Apagar treino", systemImage: "trash")
                }
            }
        }
        .navigationTitle("Treino")
        .onDisappear { store.updateWorkout(workout) }
        .sheet(isPresented: $showingAddExercise) {
            AddExerciseView(exerciseOptions: exerciseOptions) { exercise in
                workout.exercises.append(exercise)
                store.updateWorkout(workout)
                copiedGPT = false
            }
        }
        .sheet(isPresented: $showingShareSheet) {
            if let shareURL {
                ActivityView(activityItems: [shareURL])
            }
        }
    }

    private var allWorkoutsForExport: [WorkoutSession] {
        var workouts = store.workouts

        if let index = workouts.firstIndex(where: { $0.id == workout.id }) {
            workouts[index] = workout
        } else {
            workouts.insert(workout, at: 0)
        }

        return workouts
    }

    private func copyCurrentWorkoutForChatGPT() {
        store.updateWorkout(workout)
        UIPasteboard.general.string = WorkoutExportService.chatGPTClipboardText(for: workout)
        copiedGPT = true
    }

    private func shareCurrentWorkoutCSV() {
        store.updateWorkout(workout)
        let fileName = "\(filePrefix(for: workout))_treino.csv"
        shareURL = FileExportHelper.createTextFile(name: fileName, content: WorkoutExportService.csv(for: workout))
        showingShareSheet = true
    }

    private func shareFullCSV() {
        store.updateWorkout(workout)
        shareURL = FileExportHelper.createTextFile(name: "historico_treinos.csv", content: WorkoutExportService.csv(for: allWorkoutsForExport))
        showingShareSheet = true
    }

    private func shareCurrentWorkoutXLSX() {
        store.updateWorkout(workout)
        let rows = WorkoutExportService.rows(for: workout)
        let data = XLSXExportWriter.makeWorkbook(rows: rows)
        shareURL = FileExportHelper.createDataFile(name: "\(filePrefix(for: workout))_treino.xlsx", data: data)
        showingShareSheet = true
    }

    private func shareFullXLSX() {
        store.updateWorkout(workout)
        let rows = WorkoutExportService.rows(for: allWorkoutsForExport)
        let data = XLSXExportWriter.makeWorkbook(rows: rows)
        shareURL = FileExportHelper.createDataFile(name: "historico_treinos.xlsx", data: data)
        showingShareSheet = true
    }

    private func filePrefix(for workout: WorkoutSession) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let date = formatter.string(from: workout.date)
        let rawTitle = workout.title
            .folding(options: .diacriticInsensitive, locale: .current)
            .lowercased()
        let title = rawTitle.unicodeScalars.map { scalar -> Character in
            if CharacterSet.alphanumerics.contains(scalar) {
                return Character(scalar)
            }
            return "_"
        }
        let cleanedTitle = String(title).split(separator: "_").joined(separator: "_")

        return "\(date)_\(cleanedTitle.isEmpty ? "treino" : cleanedTitle)"
    }
}
