import { readFileSync } from "node:fs";

async function main() {
	const { PDFParse } = await import("pdf-parse");

	const files = [
		{
			path: "docs/rfp/한국기술대_전자결재_시스템고도화.pdf",
			name: "한국기술대",
		},
		{
			path: "docs/rfp/한국폴리텍_전자결재시스템고도화.pdf",
			name: "한국폴리텍",
		},
	];

	for (const f of files) {
		const parser = new PDFParse({ data: readFileSync(f.path) });
		const result = await parser.getText();
		await parser.destroy();

		const text = result.text;

		// Check for "요구사항" with various spacing
		console.log(`\n=== ${f.name} (${text.length}자) ===`);

		// Check for "요구사항" with possible tab chars between each char
		const patterns = ["요구사항", "요구 사항", "요구"];
		for (const p of patterns) {
			const idx = text.indexOf(p);
			console.log(
				`  "${p}" 위치: ${
					idx >= 0
						? `${idx} -> ${text
								.slice(idx, idx + 50)
								.replace(/\t/g, "\\t")
								.replace(/\n/g, "\\n")}`
						: "없음"
				}`,
			);
		}

		// Find sections with headers
		const sectionMarkers = ["Ⅰ.", "Ⅱ.", "Ⅲ.", "Ⅳ.", "1.", "가.", "요구"];
		for (const m of sectionMarkers) {
			const idx = text.indexOf(m);
			if (idx >= 0 && idx < 500) {
				console.log(
					`  첫 "${m}" 위치: ${idx} -> ${text
						.slice(idx, idx + 80)
						.replace(/\t/g, "\\t")
						.replace(/\n/g, "\\n")}`,
				);
			}
		}

		// First 300 chars
		console.log(`\n  처음 300자:\n${text.slice(0, 300).replace(/\t/g, "\\t")}`);

		// Show text around position 5000-6000 (likely section IV)
		console.log(
			`\n  4000-4500자:\n${text.slice(4000, 4500).replace(/\t/g, "\\t")}`,
		);
	}
}

main().catch(console.error);
