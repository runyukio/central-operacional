import SwiftUI

struct ContentView: View {
    @StateObject private var workoutStore = WorkoutStore()
    @StateObject private var templateStore = TemplateStore()

    var body: some View {
        TabView {
            WorkoutListView(workoutStore: workoutStore, templateStore: templateStore)
                .tabItem { Label("Treinos", systemImage: "figure.strengthtraining.traditional") }

            TemplateManagerView(templateStore: templateStore)
                .tabItem { Label("Templates", systemImage: "list.bullet.rectangle") }

            ExerciseHistoryView(store: workoutStore)
                .tabItem { Label("Histórico", systemImage: "chart.line.uptrend.xyaxis") }

            WeeklySummaryView(store: workoutStore)
                .tabItem { Label("Semana", systemImage: "calendar") }

            ExportHistoryView(store: workoutStore)
                .tabItem { Label("Exportar", systemImage: "square.and.arrow.up") }
        }
    }
}
