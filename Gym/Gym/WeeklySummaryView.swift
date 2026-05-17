import SwiftUI

struct WeeklySummaryView: View {
    @ObservedObject var store: WorkoutStore
    private var summaries: [WeeklySummary] { WorkoutAnalytics.weeklySummaries(from: store.workouts) }

    var body: some View {
        NavigationStack {
            List {
                if summaries.isEmpty {
                    Text("Registre treinos para ver o resumo semanal.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(summaries) { summary in
                        Section {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("\(summary.weekStart.formatted(date: .abbreviated, time: .omitted)) - \(summary.weekEnd.formatted(date: .abbreviated, time: .omitted))")
                                    .font(.headline)
                                HStack { Text("Treinos"); Spacer(); Text("\(summary.workoutsCount)").bold() }
                                HStack { Text("Exercícios"); Spacer(); Text("\(summary.exercisesCount)").bold() }
                                HStack { Text("Séries válidas"); Spacer(); Text("\(summary.workingSetsCount)").bold() }
                                HStack { Text("Volume total"); Spacer(); Text("\(summary.totalVolume, specifier: "%.0f") kg").bold() }
                            }.padding(.vertical, 6)
                        }
                    }
                }
            }
            .navigationTitle("Resumo semanal")
        }
    }
}
