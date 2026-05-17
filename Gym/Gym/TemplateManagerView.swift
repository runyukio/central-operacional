import SwiftUI

struct TemplateManagerView: View {
    @ObservedObject var templateStore: TemplateStore
    @State private var showingNewTemplate = false

    var body: some View {
        NavigationStack {
            List {
                Section("Templates") {
                    ForEach(templateStore.templates) { template in
                        NavigationLink {
                            TemplateEditorView(templateStore: templateStore, template: template)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(template.title).font(.headline)
                                Text("\(template.exercises.count) exercícios")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }.onDelete(perform: templateStore.deleteTemplate)
                }

                Section("Catálogo de exercícios") {
                    NavigationLink {
                        ExerciseCatalogView(templateStore: templateStore)
                    } label: {
                        Label("Gerenciar exercícios", systemImage: "dumbbell")
                    }
                }

                Section {
                    Button { templateStore.resetTemplates() } label: {
                        Label("Restaurar templates padrão", systemImage: "arrow.counterclockwise")
                    }
                }
            }
            .navigationTitle("Templates")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingNewTemplate = true } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $showingNewTemplate) {
                NewTemplateView(templateStore: templateStore)
            }
        }
    }
}

struct NewTemplateView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var templateStore: TemplateStore
    @State private var title = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Novo template") {
                    TextField("Nome do template", text: $title)
                }
            }
            .navigationTitle("Novo template")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Criar") {
                        templateStore.addTemplate(title: title)
                        dismiss()
                    }
                }
            }
        }
    }
}

struct TemplateEditorView: View {
    @ObservedObject var templateStore: TemplateStore
    @State var template: WorkoutTemplate

    @State private var selectedExercise = ""
    @State private var customExercise = ""
    @State private var useCustomExercise = false

    private var finalExerciseName: String {
        (useCustomExercise ? customExercise : selectedExercise).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        List {
            Section("Nome") {
                TextField("Nome do template", text: $template.title)
                    .onChange(of: template.title) { _, _ in templateStore.updateTemplate(template) }
            }

            Section("Adicionar exercício") {
                Toggle("Criar exercício novo", isOn: $useCustomExercise)
                if useCustomExercise {
                    TextField("Novo exercício", text: $customExercise)
                } else {
                    Picker("Exercício", selection: $selectedExercise) {
                        Text("Selecione").tag("")
                        ForEach(templateStore.exerciseCatalog, id: \.self) { Text($0).tag($0) }
                    }
                }
                Button { addExercise() } label: {
                    Label("Adicionar ao template", systemImage: "plus.circle")
                }.disabled(finalExerciseName.isEmpty)
            }

            Section("Exercícios do template") {
                if template.exercises.isEmpty {
                    Text("Nenhum exercício neste template.").foregroundStyle(.secondary)
                }
                ForEach(template.exercises, id: \.self) { Text($0) }
                    .onDelete { offsets in
                        template.exercises.remove(atOffsets: offsets)
                        templateStore.updateTemplate(template)
                    }
            }
        }
        .navigationTitle("Editar")
        .onAppear { selectedExercise = templateStore.exerciseCatalog.first ?? "" }
        .onDisappear { templateStore.updateTemplate(template) }
    }

    private func addExercise() {
        guard !finalExerciseName.isEmpty else { return }
        template.exercises.append(finalExerciseName)
        templateStore.addExerciseToCatalog(finalExerciseName)
        templateStore.updateTemplate(template)
        if useCustomExercise { customExercise = "" }
    }
}

struct ExerciseCatalogView: View {
    @ObservedObject var templateStore: TemplateStore
    @State private var newExercise = ""

    var body: some View {
        List {
            Section("Adicionar exercício") {
                TextField("Novo exercício", text: $newExercise)
                Button {
                    templateStore.addExerciseToCatalog(newExercise)
                    newExercise = ""
                } label: {
                    Label("Adicionar ao catálogo", systemImage: "plus.circle")
                }.disabled(newExercise.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            Section("Catálogo") {
                ForEach(templateStore.exerciseCatalog, id: \.self) { Text($0) }
                    .onDelete(perform: templateStore.deleteExerciseFromCatalog)
            }
        }
        .navigationTitle("Exercícios")
    }
}
