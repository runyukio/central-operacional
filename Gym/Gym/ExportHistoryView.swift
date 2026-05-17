import SwiftUI
import UIKit

struct ExportHistoryView: View {
    @ObservedObject var store: WorkoutStore
    @State private var copiedGPT = false
    @State private var copiedCSV = false
    @State private var shareURL: URL?
    @State private var showingShareSheet = false

    private var gptText: String { WorkoutExportService.gptText(for: store.workouts) }
    private var csvText: String { WorkoutExportService.csv(for: store.workouts) }
    private var xlsxData: Data { XLSXExportWriter.makeWorkbook(rows: WorkoutExportService.rows(for: store.workouts)) }

    var body: some View {
        NavigationStack {
            List {
                Section("Exportar histórico completo") {
                    Text("Copie para colar no GPT ou salve como arquivo no iPhone.")
                        .foregroundStyle(.secondary)

                    Button {
                        UIPasteboard.general.string = gptText
                        copiedGPT = true
                        copiedCSV = false
                    } label: {
                        Label(copiedGPT ? "Histórico copiado!" : "Copiar histórico para GPT", systemImage: copiedGPT ? "checkmark.circle.fill" : "doc.on.doc")
                    }

                    Button {
                        shareURL = FileExportHelper.createTextFile(name: "historico_treinos_gpt.txt", content: gptText)
                        showingShareSheet = true
                    } label: {
                        Label("Salvar/compartilhar .TXT", systemImage: "square.and.arrow.up")
                    }

                    Button {
                        UIPasteboard.general.string = csvText
                        copiedCSV = true
                        copiedGPT = false
                    } label: {
                        Label(copiedCSV ? "CSV copiado!" : "Copiar histórico em CSV", systemImage: copiedCSV ? "checkmark.circle.fill" : "tablecells")
                    }

                    Button {
                        shareURL = FileExportHelper.createTextFile(name: "historico_treinos.csv", content: csvText)
                        showingShareSheet = true
                    } label: {
                        Label("Salvar/compartilhar .CSV", systemImage: "square.and.arrow.up")
                    }

                    Button {
                        shareURL = FileExportHelper.createDataFile(name: "historico_treinos.xlsx", data: xlsxData)
                        showingShareSheet = true
                    } label: {
                        Label("Salvar/compartilhar .XLSX", systemImage: "square.and.arrow.up")
                    }
                }

                Section("Quantidade salva") {
                    HStack { Text("Treinos"); Spacer(); Text("\(store.workouts.count)").bold() }
                    HStack { Text("Exercícios registrados"); Spacer(); Text("\(store.workouts.reduce(0) { $0 + $1.exercises.count })").bold() }
                }
            }
            .navigationTitle("Exportar")
            .sheet(isPresented: $showingShareSheet) {
                if let shareURL {
                    ActivityView(activityItems: [shareURL])
                }
            }
        }
    }
}
