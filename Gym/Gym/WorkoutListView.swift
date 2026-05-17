import SwiftUI

struct WorkoutListView: View {
    @ObservedObject var workoutStore: WorkoutStore
    @ObservedObject var templateStore: TemplateStore
    @State private var showingTemplatePicker = false

    var body: some View {
        NavigationStack {
            List {
                if workoutStore.workouts.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Nenhum treino registrado ainda").font(.headline)
                        Text("Toque em + para criar um treino com seus templates.")
                            .foregroundStyle(.secondary)
                    }.padding(.vertical, 12)
                }

                ForEach(workoutStore.workouts) { workout in
                    NavigationLink {
                        WorkoutDetailView(store: workoutStore, workout: workout, exerciseOptions: templateStore.exerciseCatalog)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(workout.title).font(.headline)
                            Text(workout.date.formatted(date: .abbreviated, time: .omitted))
                                .font(.subheadline).foregroundStyle(.secondary)
                            Text("\(workout.exercises.count) exercício(s)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }.onDelete(perform: workoutStore.deleteWorkout)
            }
            .navigationTitle("Treinos")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingTemplatePicker = true } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $showingTemplatePicker) {
                TemplatePickerView(workoutStore: workoutStore, templateStore: templateStore)
            }
        }
    }
}
