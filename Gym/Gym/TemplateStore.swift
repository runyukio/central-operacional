import Foundation
import Combine
import SwiftUI

final class TemplateStore: ObservableObject {
    @Published var templates: [WorkoutTemplate] = [] { didSet { saveTemplates() } }
    @Published var exerciseCatalog: [String] = [] { didSet { saveCatalog() } }

    private let templatesKey = "gym_app_v2_templates"
    private let catalogKey = "gym_app_v2_exercise_catalog"

    init() {
        loadTemplates()
        loadCatalog()
        rebuildCatalog()
    }

    func addTemplate(title: String) {
        let cleaned = title.trimmingCharacters(in: .whitespacesAndNewlines)
        templates.append(WorkoutTemplate(title: cleaned.isEmpty ? "Novo template" : cleaned, exercises: []))
    }

    func updateTemplate(_ template: WorkoutTemplate) {
        guard let index = templates.firstIndex(where: { $0.id == template.id }) else { return }
        templates[index] = template
        addExercisesToCatalog(template.exercises)
    }

    func deleteTemplate(at offsets: IndexSet) {
        templates.remove(atOffsets: offsets)
        rebuildCatalog()
    }

    func resetTemplates() {
        templates = WorkoutDefaults.templates
        rebuildCatalog()
    }

    func addExerciseToCatalog(_ name: String) {
        let cleaned = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return }
        if !exerciseCatalog.contains(cleaned) {
            exerciseCatalog.append(cleaned)
            exerciseCatalog.sort()
        }
    }

    func addExercisesToCatalog(_ names: [String]) {
        for name in names { addExerciseToCatalog(name) }
    }

    func deleteExerciseFromCatalog(at offsets: IndexSet) {
        let names = offsets.map { exerciseCatalog[$0] }
        exerciseCatalog.remove(atOffsets: offsets)
        for index in templates.indices {
            templates[index].exercises.removeAll { names.contains($0) }
        }
    }

    private func rebuildCatalog() {
        let all = WorkoutDefaults.extraExercises + templates.flatMap { $0.exercises } + exerciseCatalog
        exerciseCatalog = Array(Set(all)).sorted()
    }

    private func saveTemplates() {
        if let data = try? JSONEncoder().encode(templates) {
            UserDefaults.standard.set(data, forKey: templatesKey)
        }
    }

    private func saveCatalog() {
        if let data = try? JSONEncoder().encode(exerciseCatalog) {
            UserDefaults.standard.set(data, forKey: catalogKey)
        }
    }

    private func loadTemplates() {
        guard let data = UserDefaults.standard.data(forKey: templatesKey),
              let saved = try? JSONDecoder().decode([WorkoutTemplate].self, from: data),
              !saved.isEmpty else {
            templates = WorkoutDefaults.templates
            return
        }
        templates = saved
    }

    private func loadCatalog() {
        guard let data = UserDefaults.standard.data(forKey: catalogKey),
              let saved = try? JSONDecoder().decode([String].self, from: data),
              !saved.isEmpty else {
            exerciseCatalog = WorkoutDefaults.extraExercises
            return
        }
        exerciseCatalog = saved
    }
}
