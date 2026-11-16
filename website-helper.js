void((async function(scan) {
		const catalogue = scan(document, location.href);
		if (!catalogue.entries.length) {
			alert("No MIDI, MusicXML or NWC links found on this page.");
			return;
		}
		if (!confirm(`Export ${catalogue.entries.length} score links and their categories to a local ChoirStar file? Scores will be downloaded using this website's sign-in. Nothing is uploaded.`)) return;
		const files = {};
		let total = 0;
		for (const entry of catalogue.entries) {
			if (files[entry.url]) continue;
			if (total > 62914560) break;
			try {
				const response = await fetch(entry.url, {
					credentials: new URL(entry.url).origin === location.origin ? "same-origin" : "omit",
					signal: AbortSignal.timeout(15e3)
				});
				if (!response.ok || /text\/html/i.test(response.headers.get("content-type") || "")) continue;
				const reader = response.body.getReader();
				const chunks = [];
				let size = 0;
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > 20971520 || total + size > 83886080) {
						await reader.cancel();
						throw new Error("Size limit");
					}
					chunks.push(value);
				}
				const blob = new Blob(chunks);
				files[entry.url] = await new Promise((resolve, reject) => {
					const r = new FileReader();
					r.onload = () => resolve(String(r.result).split(",")[1]);
					r.onerror = reject;
					r.readAsDataURL(blob);
				});
				total += size;
			} catch {}
		}
		const url = URL.createObjectURL(new Blob([JSON.stringify({
			format: "ChoirStar website",
			catalogue,
			files
		})], { type: "application/json" }));
		const a = document.createElement("a");
		a.href = url;
		const filename = `choirstar-${location.hostname.replace(/[^a-z0-9.-]/gi, "_")}.json`;
		a.download = filename;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 6e4);
		alert(`Exported ${catalogue.entries.length} links and ${Object.keys(files).length} score files. Import ${filename} in ChoirStar. Links without files can be opened for manual download.`);
	})(function scanWebsite(doc, address) {
	const page = new URL(address);
	if (!/^https?:$/.test(page.protocol) || page.username || page.password) throw new Error("Enter an HTTP or HTTPS page address without a password.");
	page.hash = "";
	const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 1e3);
	let base = page.href;
	const baseHref = doc.getElementsByTagName("base")[0]?.getAttribute("href");
	if (baseHref) try {
		base = new URL(baseHref, base).href;
	} catch {}
	const headings = [];
	const entries = [];
	const seen = /* @__PURE__ */ new Set();
	const tableGroups = /* @__PURE__ */ new Map();
	const tableSections = /* @__PURE__ */ new Map();
	for (const node of Array.from(doc.getElementsByTagName("*"))) {
		const tag = node.tagName.toLowerCase();
		if (/^h[1-6]$/.test(tag)) {
			const level = Number(tag[1]);
			while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
			const title = clean(node.textContent);
			if (title) headings.push({
				level,
				title
			});
		}
		if (tag === "tr") {
			const cells = Array.from(node.childNodes).filter((c) => c.nodeType === 1 && /^(td|th)$/i.test(c.tagName));
			let table = node.parentNode;
			while (table && table.tagName?.toLowerCase() !== "table") table = table.parentNode;
			if (table && cells.length === 1 && Number(cells[0].getAttribute("colspan")) > 1 && !node.getElementsByTagName("a").length && !node.getElementsByTagName("img").length) {
				const label = clean(cells[0].textContent);
				if (label) {
					if (/(?:\*\s*){3,}/.test(label)) {
						tableSections.set(table, label.replace(/\*/g, "").trim());
						tableGroups.set(table, []);
						continue;
					}
					const main = (node.getAttribute("style") || "").includes("background") || node.getElementsByTagName("strong").length > 0 && !node.getElementsByTagName("em").length;
					tableGroups.set(table, main ? [label] : [...(tableGroups.get(table) || []).slice(0, 1), label]);
				}
			}
		}
		if (tag !== "a" || !node.getAttribute("href")) continue;
		let url;
		try {
			url = new URL(node.getAttribute("href"), base);
		} catch {
			continue;
		}
		if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
		url.hash = "";
		const candidates = [
			node.getAttribute("download") || "",
			...Array.from(url.searchParams.values()),
			url.pathname.split("/").pop() || "",
			clean(node.textContent)
		];
		let filename = "";
		for (const candidate of candidates) {
			let decoded = candidate;
			try {
				decoded = decodeURIComponent(candidate);
			} catch {}
			if (/\.(mid|midi|musicxml|xml|nwc|nwctxt)$/i.test(decoded)) {
				filename = decoded.split(/[\\/]/).pop();
				break;
			}
		}
		if (!filename) continue;
		const category = headings.map((h) => h.title);
		let rowTitle = "";
		const parents = [];
		let parent = node.parentNode;
		while (parent && parent.nodeType === 1) {
			parents.unshift(parent);
			parent = parent.parentNode;
		}
		for (const ancestor of parents) {
			const name = ancestor.tagName.toLowerCase();
			let label = "";
			if (name === "table") {
				const section = tableSections.get(ancestor);
				if (section) category.push(section);
				category.push(...tableGroups.get(ancestor) || []);
			}
			if (name === "details") label = clean(ancestor.getElementsByTagName("summary")[0]?.textContent || "");
			if (name === "tr") {
				const cell = Array.from(ancestor.childNodes).find((c) => c.nodeType === 1 && /^(td|th)$/i.test(c.tagName));
				if (cell && !Array.from(cell.getElementsByTagName("a")).some((a) => a === node)) rowTitle = clean(Array.from(cell.childNodes).find((n) => clean(n.textContent))?.textContent || cell.textContent);
			}
			if (name === "li") {
				for (const child of Array.from(ancestor.childNodes)) {
					if (child === node || child.nodeType === 1 && /^(ul|ol|a)$/i.test(child.tagName)) break;
					label += child.textContent || "";
				}
				label = clean(label);
			}
			if (label && !category.includes(label)) category.push(label);
		}
		const identity = JSON.stringify([url.href, category]);
		if (seen.has(identity)) continue;
		seen.add(identity);
		entries.push({
			url: url.href,
			filename,
			title: rowTitle || clean(node.textContent) || filename,
			format: /\.(mid|midi)$/i.test(filename) ? "midi" : /\.(nwc|nwctxt)$/i.test(filename) ? "nwc" : "musicxml",
			category: category.slice(0, 12)
		});
	}
	return {
		url: page.href,
		title: clean(doc.getElementsByTagName("title")[0]?.textContent || doc.getElementsByTagName("h1")[0]?.textContent || "") || page.hostname,
		entries
	};
}))