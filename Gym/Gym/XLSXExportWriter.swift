import Foundation

enum XLSXExportWriter {
    static func makeWorkbook(rows: [WorkoutExportRow]) -> Data {
        var archive = SimpleZipArchive()

        archive.addFile(name: "[Content_Types].xml", contents: contentTypesXML)
        archive.addFile(name: "_rels/.rels", contents: packageRelationshipsXML)
        archive.addFile(name: "xl/workbook.xml", contents: workbookXML)
        archive.addFile(name: "xl/_rels/workbook.xml.rels", contents: workbookRelationshipsXML)
        archive.addFile(name: "xl/styles.xml", contents: stylesXML)
        archive.addFile(name: "xl/worksheets/sheet1.xml", contents: worksheetXML(rows: rows))

        return archive.data()
    }

    private static func worksheetXML(rows: [WorkoutExportRow]) -> String {
        let lastRow = max(rows.count + 1, 1)
        var xml = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <dimension ref="A1:H\(lastRow)"/>
        <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
        <cols>
        <col min="1" max="1" width="14" customWidth="1"/>
        <col min="2" max="2" width="24" customWidth="1"/>
        <col min="3" max="3" width="34" customWidth="1"/>
        <col min="4" max="4" width="16" customWidth="1"/>
        <col min="5" max="5" width="10" customWidth="1"/>
        <col min="6" max="6" width="12" customWidth="1"/>
        <col min="7" max="7" width="10" customWidth="1"/>
        <col min="8" max="8" width="42" customWidth="1"/>
        </cols>
        <sheetData>
        """

        xml += rowXML(index: 1, values: WorkoutExportService.headers, style: 1)

        for (offset, row) in rows.enumerated() {
            xml += rowXML(index: offset + 2, values: row.values, numericColumns: [5, 7])
        }

        xml += """
        </sheetData>
        <autoFilter ref="A1:H\(lastRow)"/>
        </worksheet>
        """

        return xml
    }

    private static func rowXML(
        index: Int,
        values: [String],
        numericColumns: Set<Int> = [],
        style: Int? = nil
    ) -> String {
        var xml = "<row r=\"\(index)\">"

        for (offset, value) in values.enumerated() {
            let column = offset + 1
            let reference = "\(columnName(for: column))\(index)"
            let styleAttribute = style.map { " s=\"\($0)\"" } ?? ""

            if numericColumns.contains(column), let number = Double(value.replacingOccurrences(of: ",", with: ".")) {
                xml += "<c r=\"\(reference)\"\(styleAttribute)><v>\(number.cleanString)</v></c>"
            } else {
                xml += "<c r=\"\(reference)\" t=\"inlineStr\"\(styleAttribute)><is><t>\(xmlEscaped(value))</t></is></c>"
            }
        }

        xml += "</row>"
        return xml
    }

    private static func columnName(for column: Int) -> String {
        var number = column
        var name = ""

        while number > 0 {
            let remainder = (number - 1) % 26
            name = String(UnicodeScalar(65 + remainder)!) + name
            number = (number - 1) / 26
        }

        return name
    }

    private static func xmlEscaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

    private static let contentTypesXML = """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    </Types>
    """

    private static let packageRelationshipsXML = """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>
    """

    private static let workbookXML = """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheets><sheet name="Treinos" sheetId="1" r:id="rId1"/></sheets>
    </workbook>
    """

    private static let workbookRelationshipsXML = """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    </Relationships>
    """

    private static let stylesXML = """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
    <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
    <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>
    """
}

private struct SimpleZipArchive {
    private struct Entry {
        let name: String
        let data: Data
        let crc: UInt32
        let offset: UInt32
    }

    private var body = Data()
    private var entries: [Entry] = []

    mutating func addFile(name: String, contents: String) {
        addFile(name: name, data: Data(contents.utf8))
    }

    mutating func addFile(name: String, data: Data) {
        let nameData = Data(name.utf8)
        let offset = UInt32(body.count)
        let crc = CRC32.checksum(data)
        let size = UInt32(data.count)

        body.appendUInt32LE(0x04034b50)
        body.appendUInt16LE(20)
        body.appendUInt16LE(0x0800)
        body.appendUInt16LE(0)
        body.appendUInt16LE(0)
        body.appendUInt16LE(0)
        body.appendUInt32LE(crc)
        body.appendUInt32LE(size)
        body.appendUInt32LE(size)
        body.appendUInt16LE(UInt16(nameData.count))
        body.appendUInt16LE(0)
        body.append(nameData)
        body.append(data)

        entries.append(Entry(name: name, data: data, crc: crc, offset: offset))
    }

    func data() -> Data {
        var result = body
        var centralDirectory = Data()

        for entry in entries {
            let nameData = Data(entry.name.utf8)
            let size = UInt32(entry.data.count)

            centralDirectory.appendUInt32LE(0x02014b50)
            centralDirectory.appendUInt16LE(20)
            centralDirectory.appendUInt16LE(20)
            centralDirectory.appendUInt16LE(0x0800)
            centralDirectory.appendUInt16LE(0)
            centralDirectory.appendUInt16LE(0)
            centralDirectory.appendUInt16LE(0)
            centralDirectory.appendUInt32LE(entry.crc)
            centralDirectory.appendUInt32LE(size)
            centralDirectory.appendUInt32LE(size)
            centralDirectory.appendUInt16LE(UInt16(nameData.count))
            centralDirectory.appendUInt16LE(0)
            centralDirectory.appendUInt16LE(0)
            centralDirectory.appendUInt16LE(0)
            centralDirectory.appendUInt16LE(0)
            centralDirectory.appendUInt32LE(0)
            centralDirectory.appendUInt32LE(entry.offset)
            centralDirectory.append(nameData)
        }

        let centralDirectoryOffset = UInt32(result.count)
        result.append(centralDirectory)

        result.appendUInt32LE(0x06054b50)
        result.appendUInt16LE(0)
        result.appendUInt16LE(0)
        result.appendUInt16LE(UInt16(entries.count))
        result.appendUInt16LE(UInt16(entries.count))
        result.appendUInt32LE(UInt32(centralDirectory.count))
        result.appendUInt32LE(centralDirectoryOffset)
        result.appendUInt16LE(0)

        return result
    }
}

private enum CRC32 {
    private static let table: [UInt32] = (0..<256).map { index in
        var crc = UInt32(index)
        for _ in 0..<8 {
            if crc & 1 == 1 {
                crc = (crc >> 1) ^ 0xedb88320
            } else {
                crc >>= 1
            }
        }
        return crc
    }

    static func checksum(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xffffffff

        for byte in data {
            let index = Int((crc ^ UInt32(byte)) & 0xff)
            crc = (crc >> 8) ^ table[index]
        }

        return crc ^ 0xffffffff
    }
}

private extension Data {
    mutating func appendUInt16LE(_ value: UInt16) {
        append(contentsOf: [
            UInt8(value & 0x00ff),
            UInt8((value >> 8) & 0x00ff)
        ])
    }

    mutating func appendUInt32LE(_ value: UInt32) {
        append(contentsOf: [
            UInt8(value & 0x000000ff),
            UInt8((value >> 8) & 0x000000ff),
            UInt8((value >> 16) & 0x000000ff),
            UInt8((value >> 24) & 0x000000ff)
        ])
    }
}

private extension Double {
    var cleanString: String {
        truncatingRemainder(dividingBy: 1) == 0 ? String(Int(self)) : String(self)
    }
}
