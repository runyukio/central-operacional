import Foundation
import Combine
import SwiftUI

final class WorkoutStore: ObservableObject {
    @Published var workouts: [WorkoutSession] = [] {
        didSet { save() }
    }

    private let primaryStorageKey = "gym_app_analytics_v1"
    private let legacyStorageKeys = [
        "gym_app_lean_3splits_v1",
        "gym_app_workouts_complete_fixed_v1",
        "gym_app_workouts_final_v1",
        "gym_app_workouts_v3",
        "gym_app_workouts_v2",
        "personal_treino_workouts_v1"
    ]

    init() { load() }

    func addWorkout(_ workout: WorkoutSession) {
        workouts.insert(workout, at: 0)
    }

    func deleteWorkout(at offsets: IndexSet) {
        workouts.remove(atOffsets: offsets)
    }

    func deleteWorkout(_ workout: WorkoutSession) {
        workouts.removeAll { $0.id == workout.id }
    }

    func updateWorkout(_ workout: WorkoutSession) {
        guard let index = workouts.firstIndex(where: { $0.id == workout.id }) else { return }
        workouts[index] = workout
    }

    private func save() {
        do {
            let data = try JSONEncoder().encode(workouts)
            UserDefaults.standard.set(data, forKey: primaryStorageKey)
        } catch {
            print("Erro ao salvar treinos: \(error)")
        }
    }

    private func load() {
        if let loaded = loadFromKey(primaryStorageKey) {
            workouts = loaded
            return
        }
        for key in legacyStorageKeys {
            if let loaded = loadFromKey(key) {
                workouts = loaded
                save()
                return
            }
        }
    }

    private func loadFromKey(_ key: String) -> [WorkoutSession]? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode([WorkoutSession].self, from: data)
    }
}
