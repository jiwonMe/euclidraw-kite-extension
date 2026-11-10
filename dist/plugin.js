var e = {
	id: "kite.studio",
	title: "Kite Studio",
	version: "0.1.0",
	summary: "Domain · Substance · Style 3분할 DSL과 다양체 정사영 솔버로, 구속 조건이 살아있는 기하 도해를 캔버스에 만듭니다.",
	engine: "^0.1.0",
	dependencies: {},
	optionalDependencies: { "sys.minibuffer": "^0.1.0" },
	conflicts: [],
	provides: {
		services: ["kite.api"],
		hsmSlots: []
	},
	commands: [
		"insert-diagram",
		"apply-dsl",
		"reset-example",
		"add-point",
		"add-constraint",
		"constrain-on-circle",
		"constrain-midpoint",
		"constrain-perpendicular",
		"constrain-equal-length",
		"constrain-horizontal",
		"constrain-vertical",
		"constrain-tangent",
		"set-distance",
		"freeze-geometry",
		"repair-bindings",
		"reproject"
	]
}, t = e.id, n = e.summary;
e.version;
var r = "kite.scope", i = "kite.member", a = Object.freeze([r, i]), o = Object.freeze({
	triEditor: "kite.panel.tri-editor",
	diagnostics: "kite.panel.diagnostics"
}), s = Object.freeze([...e.commands ?? []]), c = (e) => `${t}:${e}`, l = Object.freeze({
	insert: c("insert-diagram"),
	apply: c("apply-dsl"),
	reset: c("reset-example"),
	addPoint: c("add-point"),
	addConstraint: c("add-constraint"),
	onCircle: c("constrain-on-circle"),
	midpoint: c("constrain-midpoint"),
	perpendicular: c("constrain-perpendicular"),
	equalLength: c("constrain-equal-length"),
	horizontal: c("constrain-horizontal"),
	vertical: c("constrain-vertical"),
	tangent: c("constrain-tangent"),
	distance: c("set-distance"),
	freeze: c("freeze-geometry"),
	repair: c("repair-bindings"),
	reproject: c("reproject")
});
function u(t = e) {
	return {
		id: t.id,
		version: t.version,
		engine: t.engine,
		dependencies: { ...t.dependencies },
		optionalDependencies: { ...t.optionalDependencies },
		conflicts: [...t.conflicts],
		provides: {
			services: [...t.provides.services],
			aspects: [...a],
			hsmSlots: [...t.provides.hsmSlots]
		}
	};
}
var d = Object.freeze(u());
Object.freeze(s.map((e) => c(e)));
// src/defaults.ts
var f = Object.freeze({
	maxSubstepsPerFrame: 12,
	convergenceTolerance: 1e-5,
	damping: .98,
	autoPromoteSnap: !0
}), p = "# Kite Studio — Domain DSL\n# type <Name> shape <primitive>\ntype Point shape point\ntype Segment shape segment\ntype Line shape line\ntype Ray shape ray\ntype Circle shape circle\ntype Arc shape arc\ntype Polygon shape polygon\ntype Angle shape angle-mark\ntype Label shape label-anchor\n\n# predicate <Name>(<Type>, ...)\npredicate Distance(Point, Point, Number)\npredicate OnCircle(Point, Circle)\npredicate OnLine(Point, Line)\npredicate Midpoint(Point, Point, Point)\npredicate Perpendicular(Segment, Segment)\npredicate Parallel(Segment, Segment)\npredicate EqualLength(Segment, Segment)\npredicate Tangent(Segment, Circle)\npredicate Coincident(Point, Point)\npredicate Horizontal(Segment)\npredicate Vertical(Segment)\npredicate Radius(Circle, Number)\npredicate AngleAt(Point, Point, Point, Number)\npredicate Fixed(Point)\n", m = "# Kite Studio — Substance DSL\n# Point A = (x, y) [pin]\nPoint A = (80, 240) pin\nPoint B = (260, 240) pin\nPoint C = (260, 60)\nPoint M = (170, 150)\nPoint P = (297, 150)\n\nSegment AB = A .. B\nSegment BC = B .. C\nSegment CA = C .. A\nSegment BM = B .. M\n\nCircle c1 = center M r 127\n\nAngle angB = A B C\nLabel labC = \"c₁\" at center c1 offset (0, 16)\n\n# 논리 구속: 바깥 점을 끌어도 이 관계가 유지됩니다.\nPerpendicular(AB, BC)\nEqualLength(AB, BC)\nMidpoint(M, A, C)\nOnCircle(B, c1)\nOnCircle(P, c1)\n", h = "# Kite Studio — Style DSL\npoint { r: 4.5; fill: #2563eb; stroke: #ffffff; width: 1.5; label: false }\nsegment { stroke: #475569; width: 2; ticks: true }\nline { stroke: #475569; width: 2 }\nray { stroke: #475569; width: 2 }\ncircle { stroke: #94a3b8; width: 1.75; fill: none }\narc { stroke: #f59e0b; width: 1.75 }\npolygon { stroke: #475569; width: 2; fill: none }\nangle-mark { stroke: #f59e0b; width: 1.5; radius: 22; label: false }\nlabel-anchor { fill: #334155; fontSize: 15 }\n\nA { label: \"A\" }\nB { label: \"B\" }\nC { label: \"C\" }\nM { label: \"M\" }\nP { label: \"P\"; fill: #dc2626 }\nc1 { label: false }\nangB { label: \"90°\"; fontSize: 13 }\n";
Object.freeze({
	schemaVersion: 1,
	domainDsl: p,
	substanceDsl: m,
	styleDsl: h,
	solverConfig: f
});
function g() {
	return {
		schemaVersion: 1,
		domainDsl: p,
		substanceDsl: m,
		styleDsl: h,
		solverConfig: { ...f },
		entityBindings: {},
		convergedSeeds: {}
	};
}
function _(e) {
	let t = e ?? {}, n = Number(t.maxSubstepsPerFrame), r = Number(t.convergenceTolerance), i = Number(t.damping);
	return {
		maxSubstepsPerFrame: Number.isFinite(n) ? Math.max(1, Math.min(64, Math.round(n))) : f.maxSubstepsPerFrame,
		convergenceTolerance: Number.isFinite(r) && r > 0 ? Math.min(1, r) : f.convergenceTolerance,
		damping: Number.isFinite(i) ? Math.max(.5, Math.min(1, i)) : f.damping,
		autoPromoteSnap: t.autoPromoteSnap === void 0 ? f.autoPromoteSnap : !!t.autoPromoteSnap
	};
}
function v(e) {
	return {
		schemaVersion: 1,
		domainDsl: typeof e?.domainDsl == "string" ? e.domainDsl : p,
		substanceDsl: typeof e?.substanceDsl == "string" ? e.substanceDsl : m,
		styleDsl: typeof e?.styleDsl == "string" ? e.styleDsl : h,
		entityBindings: e?.entityBindings && typeof e.entityBindings == "object" ? e.entityBindings : {},
		convergedSeeds: e?.convergedSeeds && typeof e.convergedSeeds == "object" ? e.convergedSeeds : {},
		solverConfig: _(e?.solverConfig)
	};
}
// src/dsl/tokens.ts
var y = Object.freeze([
	"point",
	"segment",
	"line",
	"ray",
	"circle",
	"arc",
	"polygon",
	"angle-mark",
	"label-anchor"
]), b = {
	angle: "angle-mark",
	label: "label-anchor",
	text: "label-anchor"
};
function x(e) {
	let t = e.trim().toLowerCase();
	return b[t] ?? t;
}
function ee(e) {
	return y.includes(e);
}
function S(e) {
	let t = null;
	for (let n = 0; n < e.length; n++) {
		let r = e[n];
		if (t) r === "\\" ? n++ : r === t && (t = null);
		else if (r === "\"" || r === "'") t = r;
		else if (r === "/" && e[n + 1] === "/") return e.slice(0, n).trimEnd();
	}
	return e.trimEnd();
}
function C(e) {
	let t = [];
	return String(e ?? "").split(/\r?\n/).forEach((e, n) => {
		let r = e.trim();
		if (!r || r.startsWith("#")) return;
		let i = S(r).trim();
		i && t.push({
			number: n + 1,
			text: i
		});
	}), t;
}
function te(e) {
	let t = [], n = "", r = null, i = 0;
	for (let a = 0; a < e.length; a++) {
		let o = e[a];
		if (r) {
			if (n += o, o === "\\") {
				n += e[++a] ?? "";
				continue;
			}
			o === r && (r = null);
		} else o === "\"" || o === "'" ? (r = o, n += o) : o === "(" ? (i++, n += o) : o === ")" ? (i--, n += o) : o === "," && i === 0 ? (t.push(n.trim()), n = "") : n += o;
	}
	return (n.trim() || t.length) && t.push(n.trim()), t;
}
function ne(e) {
	let t = e.trim();
	return t.length >= 2 && (t[0] === "\"" || t[0] === "'") && t[t.length - 1] === t[0] ? t.slice(1, -1).replace(/\\(["'\\n])/g, (e, t) => t === "n" ? "\n" : t) : t;
}
function w(e) {
	if (typeof e == "number") return Number.isFinite(e) ? e : void 0;
	let t = Number(e.trim());
	return Number.isFinite(t) ? t : void 0;
}
function re(e) {
	let t = /^\(?\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)?$/.exec(e.trim());
	if (!t) return;
	let n = w(t[1]), r = w(t[2]);
	return n === void 0 || r === void 0 ? void 0 : [n, r];
}
function T(e) {
	let t = w(e);
	return t === void 0 ? void 0 : t * Math.PI / 180;
}
function E(e) {
	return typeof e == "string" && /^[A-Za-z_][\w-]*$/.test(e);
}
function D(e, t) {
	return typeof e == "number" && Number.isFinite(e) ? e : t;
}
function O(e, t) {
	return typeof e == "number" && Number.isFinite(e) && e > 0 ? e : t;
}
function ie(e, t, n) {
	return e < t ? t : e > n ? n : e;
}
function k(e, t) {
	return {
		line: Number.isFinite(e) ? e : 0,
		message: String(t)
	};
}
// src/dsl/domain.ts
function ae(e) {
	let t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), r = [];
	for (let i of C(e)) {
		let e = i.text, a = /^type\s+([A-Za-z_]\w*)(?:\s+shape\s+([A-Za-z][\w-]*))?(?:\s+extends\s+([A-Za-z_]\w*))?\s*$/.exec(e);
		if (a) {
			let [, e, n, o] = a;
			n !== void 0 && !ee(x(n)) && r.push(k(i.number, `알 수 없는 프리미티브 shape: ${n}`)), t.has(e) && r.push(k(i.number, `타입 ${e}이(가) 중복 선언되었습니다.`)), t.set(e, {
				name: e,
				...n === void 0 ? {} : { shape: x(n) },
				...o === void 0 ? {} : { parent: o },
				line: i.number
			});
		} else if (a = /^predicate\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*$/.exec(e), a) {
			let [, e, t] = a, o = t.trim() ? t.split(",").map((e) => e.trim()) : [];
			o.some((e) => !E(e)) && r.push(k(i.number, `predicate ${e}의 인자 타입은 식별자여야 합니다.`)), n.has(e) && r.push(k(i.number, `predicate ${e}이(가) 중복 선언되었습니다.`)), n.set(e, {
				name: e,
				args: o,
				line: i.number
			});
		} else r.push(k(i.number, `Domain 문법을 해석할 수 없습니다: ${e}`));
	}
	return t.size || r.push(k(0, "Domain DSL에 타입이 하나도 없습니다.")), {
		types: t,
		predicates: n,
		errors: r,
		typeNames: [...t.keys()],
		predicateNames: [...n.keys()]
	};
}
function oe(e, t) {
	let n = e.types.get(t), r = /* @__PURE__ */ new Set();
	for (; n;) {
		if (n.shape) return n.shape;
		if (!n.parent || r.has(n.parent)) return;
		r.add(n.parent), n = e.types.get(n.parent);
	}
}
// src/dsl/substance.ts
function se(e, t) {
	let n = /* @__PURE__ */ new Map(), r = [], i = /* @__PURE__ */ new Set(), a = [];
	for (let o of C(e)) {
		let e = o.text, s = /^(pin|unpin)\s+([A-Za-z_]\w*)\s*$/.exec(e);
		if (s) {
			s[1] === "pin" ? i.add(s[2]) : i.delete(s[2]);
			continue;
		}
		if (s = /^(soft\s+)?([A-Za-z_]\w*)\s*\((.*)\)\s*$/.exec(e), s) {
			let [, e, t, n] = s, a = te(n);
			r.push({
				name: t,
				args: a,
				soft: !!e,
				line: o.number
			}), t === "Fixed" && a[0] && i.add(a[0]);
			continue;
		}
		if (s = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(e), !s) {
			a.push(k(o.number, `Substance 문법을 해석할 수 없습니다: ${e}`));
			continue;
		}
		let [, c, l, u] = s, d = l;
		if (n.has(d)) {
			a.push(k(o.number, `개체 ${d}이(가) 중복 선언되었습니다.`));
			continue;
		}
		let f = oe(t, c);
		if (!f) {
			a.push(k(o.number, `Domain에 없는 타입입니다: ${c}`));
			continue;
		}
		let p = u.trim(), m = {
			id: d,
			typeName: c,
			kind: f,
			line: o.number
		};
		try {
			if (f === "point") {
				let e = /(?:^|\s)pin\s*$/.test(p), t = re(p.replace(/(?:^|\s)pin\s*$/, ""));
				if (!t) throw Error("점 좌표는 (x, y) 형식이어야 합니다.");
				m.x = t[0], m.y = t[1], m.pinned = e, e && i.add(d);
			} else if (f === "circle") {
				let e = /^center\s+([A-Za-z_]\w*)\s+r\s+(.+)$/i.exec(p), t = /^center\s+([A-Za-z_]\w*)\s+through\s+([A-Za-z_]\w*)$/i.exec(p);
				if (e) {
					m.center = e[1];
					let t = w(e[2]);
					if (t === void 0 || t <= 0) throw Error("원 반지름 r은 양수여야 합니다.");
					m.radius = t;
				} else if (t) m.center = t[1], m.through = t[2], m.radius = 100, r.push({
					name: "OnCircle",
					args: [t[2], d],
					soft: !1,
					line: o.number,
					implicit: !0
				});
				else throw Error("원은 `center <점> r <반지름>` 또는 `center <점> through <점>`으로 선언합니다.");
			} else if (f === "segment" || f === "line" || f === "ray") {
				let e = /^([A-Za-z_]\w*)\s*\.\.\s*([A-Za-z_]\w*)$/.exec(p);
				if (!e) throw Error("선분은 `A .. B` 형식이어야 합니다.");
				m.a = e[1], m.b = e[2];
			} else if (f === "arc") {
				let e = /^center\s+([A-Za-z_]\w*)\s+r\s+(\S+)\s+from\s+(\S+)\s+to\s+(\S+)$/i.exec(p);
				if (!e) throw Error("호는 `center <점> r <반지름> from <도> to <도>` 형식이어야 합니다.");
				let t = w(e[2]), n = T(e[3]), r = T(e[4]);
				if (t === void 0 || t <= 0 || n === void 0 || r === void 0) throw Error("호의 반지름과 각도가 유효하지 않습니다.");
				m.center = e[1], m.radius = t, m.startAngle = n, m.endAngle = r;
			} else if (f === "polygon") {
				let e = p.split(/\s+/).filter(Boolean);
				if (e.length < 3 || e.some((e) => !E(e))) throw Error("다각형은 세 개 이상의 점 이름이 필요합니다.");
				m.points = e;
			} else if (f === "angle-mark") {
				let e = p.split(/\s+/).filter(Boolean);
				if (e.length !== 3 || e.some((e) => !E(e))) throw Error("각도 표기는 `A B C`처럼 세 점이 필요합니다.");
				m.angle = [
					e[0],
					e[1],
					e[2]
				];
			} else f === "label-anchor" && (m.label = ce(p));
		} catch (e) {
			a.push(k(o.number, `${c} ${d}: ${e instanceof Error ? e.message : String(e)}`));
			continue;
		}
		n.set(d, m);
	}
	for (let e of n.values()) {
		for (let [t, r] of [
			["center", "point"],
			["a", "point"],
			["b", "point"],
			["through", "point"]
		]) {
			let i = e[t];
			if (i === void 0) continue;
			let o = n.get(i);
			o ? o.kind !== r && a.push(k(e.line, `${e.id}: ${i}은(는) 점이 아닙니다.`)) : a.push(k(e.line, `${e.id}: ${i} 개체를 찾을 수 없습니다.`));
		}
		for (let t of e.points ?? []) n.get(t)?.kind !== "point" && a.push(k(e.line, `${e.id}: ${t}은(는) 점이 아닙니다.`));
		for (let t of e.angle ?? []) n.get(t)?.kind !== "point" && a.push(k(e.line, `${e.id}: ${t}은(는) 점이 아닙니다.`));
		if (e.label) {
			let t = e.label.anchor, r = n.get(t.id);
			r ? t.kind === "point" && r.kind !== "point" ? a.push(k(e.line, `${e.id}: ${t.id}은(는) 점이 아닙니다.`)) : t.kind === "center" && ![
				"circle",
				"arc",
				"polygon"
			].includes(r.kind) ? a.push(k(e.line, `${e.id}: ${t.id}은(는) 중심을 가진 개체가 아닙니다.`)) : t.kind === "midpoint" && ![
				"segment",
				"line",
				"ray"
			].includes(r.kind) && a.push(k(e.line, `${e.id}: ${t.id}은(는) 선분이 아닙니다.`)) : a.push(k(e.line, `${e.id}: ${t.id} 개체를 찾을 수 없습니다.`));
		}
	}
	return {
		instances: n,
		constraints: r,
		pinned: i,
		errors: a
	};
}
function ce(e) {
	let t = /^(.+?)\s+at\s+(point|center|midpoint)\s+([A-Za-z_]\w*)\s+offset\s+(.+)$/i.exec(e);
	if (!t) throw Error("라벨은 `\"텍스트\" at midpoint <id> offset <값>` 형식이어야 합니다.");
	let n = ne(t[1]);
	if (!n) throw Error("라벨 텍스트가 비어 있습니다.");
	let r = {
		kind: t[2].toLowerCase(),
		id: t[3]
	}, i = t[4].trim(), a = re(i) ?? w(i);
	if (a === void 0) throw Error("라벨 오프셋이 유효하지 않습니다.");
	return {
		text: n,
		anchor: r,
		...Array.isArray(a) ? {
			offsetX: a[0],
			offsetY: a[1],
			offsetMode: "vector"
		} : {
			offset: a,
			offsetMode: "normal"
		}
	};
}
var le = Object.freeze([
	"Distance",
	"OnCircle",
	"OnLine",
	"Midpoint",
	"Perpendicular",
	"Parallel",
	"EqualLength",
	"Tangent",
	"Coincident",
	"Horizontal",
	"Vertical",
	"Radius",
	"AngleAt",
	"Fixed"
]);
// src/dsl/style.ts
function ue(e) {
	let t = [], n = [], r = String(e ?? "").replace(/\r\n/g, "\n").split("\n").map((e) => /^\s*(#|\/\/)/.test(e) ? "" : e).join("\n"), i = /([^{}]+)\{([^{}]*)\}/g, a, o = 0;
	for (; a = i.exec(r);) {
		let e = r.slice(o, a.index);
		for (let t of e.split("\n")) {
			let i = t.trim();
			i && !i.startsWith("#") && !i.startsWith("//") && n.push(k(de(r, o + e.indexOf(t)), `Style 규칙 밖의 텍스트: ${i}`));
		}
		o = i.lastIndex;
		let s = a[1].replace(/\s+/g, " ").split(",").map((e) => e.trim()).filter(Boolean);
		if (!s.length) {
			n.push(k(de(r, a.index), "Style 선택자가 비어 있습니다."));
			continue;
		}
		let c = {}, l = a[2].replace(/\n/g, ";");
		for (let e of l.split(";")) {
			let t = e.trim();
			if (!t) continue;
			let i = /^([A-Za-z_][\w-]*)\s*[:=]\s*(.+)$/.exec(t);
			i ? c[i[1]] = fe(i[2]) : n.push(k(de(r, a.index), `Style 속성을 해석할 수 없습니다: ${t}`));
		}
		t.push({
			selectors: s,
			props: c,
			line: de(r, a.index)
		});
	}
	let s = r.slice(o);
	for (let e of s.split("\n")) {
		let t = e.trim();
		t && !t.startsWith("#") && !t.startsWith("//") && n.push(k(0, `닫히지 않은 Style 규칙: ${t}`));
	}
	return {
		rules: t,
		errors: n
	};
}
function de(e, t) {
	return e.slice(0, Math.max(0, t)).split("\n").length;
}
function fe(e) {
	let t = e.trim();
	if (!t) return "";
	if ((t[0] === "\"" || t[0] === "'") && t[t.length - 1] === t[0]) return ne(t);
	if (t === "true") return !0;
	if (t === "false") return !1;
	if (t === "none") return "none";
	if (t === "null") return null;
	let n = w(t);
	return n === void 0 ? t : n;
}
function pe(e, { id: t, kind: n, typeName: r }) {
	let i = {};
	for (let a of e) for (let e of a.selectors) if (e === t || e === n || e === r) {
		Object.assign(i, a.props);
		break;
	}
	return i;
}
function me(e) {
	let t = [];
	for (let n of e) for (let [e, r] of Object.entries(n.props)) if (typeof r == "number") for (let i of n.selectors) t.push({
		selector: i,
		key: e,
		value: r,
		line: n.line
	});
	return t;
}
// src/dsl/compile.ts
var he = {
	point: {
		r: 4.5,
		fill: "#2563eb",
		stroke: "#ffffff",
		width: 1.5,
		label: !1,
		fontSize: 14
	},
	segment: {
		stroke: "#475569",
		width: 2,
		fill: "none",
		dash: 0,
		ticks: !0
	},
	line: {
		stroke: "#475569",
		width: 2,
		fill: "none",
		dash: 0,
		ticks: !1
	},
	ray: {
		stroke: "#475569",
		width: 2,
		fill: "none",
		dash: 0,
		ticks: !1
	},
	circle: {
		stroke: "#94a3b8",
		width: 1.75,
		fill: "none",
		dash: 0
	},
	arc: {
		stroke: "#f59e0b",
		width: 1.75,
		fill: "none",
		dash: 0
	},
	polygon: {
		stroke: "#475569",
		width: 2,
		fill: "none",
		dash: 0
	},
	"angle-mark": {
		stroke: "#f59e0b",
		width: 1.5,
		fill: "none",
		radius: 22,
		label: !1,
		fontSize: 13
	},
	"label-anchor": {
		stroke: "none",
		fill: "#334155",
		width: 0,
		fontSize: 15
	}
}, ge = [
	"segment",
	"line",
	"ray"
], _e = .25;
function ve(e) {
	let t = String(e.domainDsl ?? ""), n = String(e.substanceDsl ?? ""), r = String(e.styleDsl ?? ""), i = ae(t), a = se(n, i), o = ue(r), s = [
		...i.errors,
		...a.errors,
		...o.errors
	], { instances: c, constraints: l, pinned: u } = a;
	for (let e of l) {
		le.includes(e.name) || s.push(k(e.line, `지원하지 않는 predicate입니다: ${e.name}`));
		let t = i.predicates.get(e.name);
		t && t.args.length !== e.args.length && s.push(k(e.line, `${e.name}은(는) 인자 ${t.args.length}개가 필요합니다.`));
	}
	let d = [], f = new Set(u);
	for (let e of l) {
		if (!le.includes(e.name)) continue;
		let t = Se(e, c, s);
		t && (t.type === "fixed" ? f.add(t.point) : d.push(t));
	}
	let p = [], m = 0;
	for (let e of c.values()) e.kind === "point" ? (p.push({
		instanceId: e.id,
		kind: "point",
		offset: m,
		size: 2
	}), m += 2) : e.kind === "circle" && (p.push({
		instanceId: e.id,
		kind: "circle",
		offset: m,
		size: 1
	}), m += 1);
	let h = p.map((e) => `${e.instanceId}:${e.kind}:${e.offset}`).join("|"), g = /* @__PURE__ */ new Map();
	for (let e of c.values()) g.set(e.id, {
		...he[e.kind] ?? {},
		...pe(o.rules, {
			id: e.id,
			kind: e.kind,
			typeName: e.typeName
		})
	});
	return {
		key: `${t}\u0000${n}\u0000${r}`,
		ok: s.length === 0,
		errors: s,
		domain: i,
		substance: a,
		style: o,
		instances: c,
		order: [...c.keys()],
		constraints: d,
		pinned: f,
		dofs: p,
		dofCount: m,
		layoutSignature: h,
		styles: g,
		badges: we(c, d),
		labels: [...c.values()].filter((e) => e.kind === "label-anchor"),
		bindings: { ...e.entityBindings ?? {} }
	};
}
function ye(e, t, n, r, i) {
	let a = e.get(t);
	if (!a) i.push(k(r.line, `${r.name}: ${t} 개체를 찾을 수 없습니다.`));
	else if (n && !n.includes(a.kind)) i.push(k(r.line, `${r.name}: ${t}의 종류가 맞지 않습니다 (${a.kind}).`));
	else return a;
}
function A(e, t, n, r) {
	return ye(e, t, ["point"], n, r);
}
function be(e, t, n, r) {
	return ye(e, t, ge, n, r);
}
function xe(e, t, n, r) {
	return ye(e, t, ["circle"], n, r);
}
function Se(e, t, n) {
	let { name: r, args: i, soft: a, line: o } = e, s = a ? _e : 1, c = (e) => {
		n.push(k(o, `${r}: ${e}`));
	}, l = (e, t = "값") => {
		let n = w(e ?? "");
		if (n === void 0) c(`${t}이(가) 숫자가 아닙니다: ${e ?? ""}`);
		else return n;
	}, u = Ce(e);
	switch (r) {
		case "Distance": {
			if (i.length !== 3) return c("인자 2개와 거리 1개가 필요합니다.");
			if (!A(t, i[0], e, n) || !A(t, i[1], e, n)) return;
			let r = l(i[2], "거리");
			return r === void 0 ? void 0 : {
				type: "distance",
				a: i[0],
				b: i[1],
				value: r,
				soft: a,
				weight: s,
				sourceLine: o,
				text: u
			};
		}
		case "OnCircle": return i.length === 2 ? !A(t, i[0], e, n) || !xe(t, i[1], e, n) ? void 0 : {
			type: "onCircle",
			point: i[0],
			circle: i[1],
			soft: a,
			weight: s,
			sourceLine: o,
			text: u
		} : c("점과 원이 필요합니다.");
		case "OnLine": return i.length === 2 ? !A(t, i[0], e, n) || !be(t, i[1], e, n) ? void 0 : {
			type: "onLine",
			point: i[0],
			line: i[1],
			soft: a,
			weight: s,
			sourceLine: o,
			text: u
		} : c("점과 선이 필요합니다.");
		case "Midpoint": return i.length === 3 ? i.every((r) => A(t, r, e, n)) ? {
			type: "midpoint",
			point: i[0],
			a: i[1],
			b: i[2],
			soft: a,
			weight: s,
			sourceLine: o,
			text: u
		} : void 0 : c("중점과 두 끝점이 필요합니다.");
		case "Perpendicular":
		case "Parallel":
		case "EqualLength": return i.length === 2 ? !be(t, i[0], e, n) || !be(t, i[1], e, n) ? void 0 : {
			type: r === "Perpendicular" ? "perpendicular" : r === "Parallel" ? "parallel" : "equallength",
			a: i[0],
			b: i[1],
			soft: a,
			weight: s,
			sourceLine: o,
			text: u
		} : c("선분 두 개가 필요합니다.");
		case "Tangent": return i.length === 2 ? !be(t, i[0], e, n) || !xe(t, i[1], e, n) ? void 0 : {
			type: "tangent",
			line: i[0],
			circle: i[1],
			soft: a,
			weight: s,
			sourceLine: o,
			text: u
		} : c("선과 원이 필요합니다.");
		case "Coincident": return i.length === 2 ? i.every((r) => A(t, r, e, n)) ? {
			type: "coincident",
			a: i[0],
			b: i[1],
			soft: a,
			weight: s,
			sourceLine: o,
			text: u
		} : void 0 : c("점 두 개가 필요합니다.");
		case "Horizontal":
		case "Vertical": return i.length === 1 ? be(t, i[0], e, n) ? {
			type: r === "Horizontal" ? "horizontal" : "vertical",
			segment: i[0],
			soft: a,
			weight: s,
			sourceLine: o,
			text: u
		} : void 0 : c("선분 하나가 필요합니다.");
		case "Radius": {
			if (i.length !== 2) return c("원과 반지름이 필요합니다.");
			if (!xe(t, i[0], e, n)) return;
			let r = l(i[1], "반지름");
			return r === void 0 ? void 0 : {
				type: "radius",
				circle: i[0],
				value: r,
				soft: a,
				weight: s,
				sourceLine: o,
				text: u
			};
		}
		case "AngleAt": {
			if (i.length !== 4) return c("꼭짓점, 두 점, 각도가 필요합니다.");
			if (!i.slice(0, 3).every((r) => A(t, r, e, n))) return;
			let r = l(i[3], "각도");
			return r === void 0 ? void 0 : {
				type: "angleat",
				vertex: i[0],
				a: i[1],
				b: i[2],
				value: r * Math.PI / 180,
				soft: a,
				weight: s,
				sourceLine: o,
				text: u
			};
		}
		case "Fixed": return i.length === 1 ? A(t, i[0], e, n) ? {
			type: "fixed",
			point: i[0],
			soft: !1,
			weight: 1,
			sourceLine: o,
			text: u
		} : void 0 : c("점 하나가 필요합니다.");
		default: return c("알 수 없는 predicate입니다.");
	}
}
function Ce(e) {
	return `${e.soft ? "soft " : ""}${e.name}(${e.args.join(", ")})`;
}
function we(e, t) {
	let n = /* @__PURE__ */ new Map(), r = [], i = /* @__PURE__ */ new Map();
	for (let e of t) e.type === "equallength" ? (n.set(e.a, (n.get(e.a) ?? 0) + 1), n.set(e.b, (n.get(e.b) ?? 0) + 1)) : e.type === "onCircle" && i.set(e.point, e.circle);
	for (let n of t) {
		if (n.type !== "perpendicular") continue;
		let t = e.get(n.a), i = e.get(n.b);
		if (!t || !i) continue;
		let a = [t.a, t.b].find((e) => e === i.a || e === i.b);
		a && r.push({
			vertex: a,
			a: n.a,
			b: n.b
		});
	}
	return {
		ticks: n,
		rightAngles: r,
		onCircle: i
	};
}
var Te = 180;
function Ee(e, t) {
	let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map();
	for (let [i, a] of Object.entries(e.bindings)) {
		let e = t.getCanonical(a, "kite.member");
		e && (n.set(i, Array.isArray(e.pinnedDofs) ? e.pinnedDofs : []), r.set(i, Number.isFinite(e.slackWeight) ? Number(e.slackWeight) : 1));
	}
	return {
		pinnedDofs: n,
		slackWeight: r
	};
}
function De(e, t) {
	if (!t || typeof t != "object") return !1;
	let n = !1;
	for (let r of e.instances.values()) {
		let i = e.bindings[r.id];
		if (!i) {
			(r.kind === "point" || r.kind === "circle") && (n = !0);
			continue;
		}
		let a = t[i];
		if (r.kind === "point") {
			if (!Array.isArray(a) || a.length !== 2 || !a.every((e) => Number.isFinite(e))) return !1;
		} else if (r.kind === "circle" && (!Array.isArray(a) || a.length !== 1 || !Number.isFinite(a[0]))) return !1;
	}
	return !n;
}
function j(e, t) {
	let n = new Float64Array(e.dofCount), r = new Uint8Array(e.dofCount);
	r.fill(1);
	let i = /* @__PURE__ */ new Map();
	for (let t of e.dofs) i.set(t.instanceId, {
		offset: t.offset,
		size: t.size,
		kind: t.kind
	});
	for (let n of e.instances.values()) {
		let a = i.get(n.id);
		if (!a) continue;
		n.kind === "point" && e.pinned.has(n.id) && (r[a.offset] = 0, r[a.offset + 1] = 0);
		let o = t?.pinnedDofs.get(n.id) ?? [];
		for (let e of o) {
			let t = a.offset + Math.trunc(e);
			Number.isInteger(e) && e >= 0 && e < a.size && t < r.length && (r[t] = 0);
		}
	}
	return {
		values: n,
		free: r,
		offsets: i
	};
}
function Oe(e, t, n) {
	let r = De(t, n);
	for (let i of t.instances.values()) {
		let a = e.offsets.get(i.id);
		if (!a) continue;
		let o = r ? n?.[t.bindings[i.id] ?? ""] : void 0;
		i.kind === "point" ? (e.values[a.offset] = o && o.length === 2 ? o[0] : i.x ?? 0, e.values[a.offset + 1] = o && o.length === 2 ? o[1] : i.y ?? 0) : i.kind === "circle" && (e.values[a.offset] = o && o.length === 1 ? o[0] : i.radius ?? 100);
	}
}
function M(e, t) {
	let n = e.offsets.get(t);
	return !n || n.kind !== "point" ? {
		x: 0,
		y: 0
	} : {
		x: e.values[n.offset],
		y: e.values[n.offset + 1]
	};
}
function N(e, t) {
	let n = e.offsets.get(t);
	return !n || n.kind !== "circle" ? 0 : e.values[n.offset];
}
function P(e, t, n, r) {
	let i = e.offsets.get(t);
	i && i.kind === "point" && (e.free[i.offset] && (e.values[i.offset] += n), e.free[i.offset + 1] && (e.values[i.offset + 1] += r));
}
function ke(e, t, n) {
	return M(e, t.instances.get(n)?.center ?? "");
}
function Ae(e, t, n) {
	let r = e.offsets.get(t);
	r && r.kind === "circle" && e.free[r.offset] && (e.values[r.offset] = Math.max(.001, e.values[r.offset] + n));
}
function F(e, t) {
	if (!t || t.a === void 0 || t.b === void 0) return;
	let n = M(e, t.a), r = M(e, t.b);
	return {
		ax: n.x,
		ay: n.y,
		bx: r.x,
		by: r.y
	};
}
function je(e) {
	return {
		x: (e.ax + e.bx) / 2,
		y: (e.ay + e.by) / 2
	};
}
function Me(e, t, n) {
	if (!t.a || !t.b || !Number.isFinite(n) || Math.abs(n) < 1e-12) return;
	let r = e.offsets.get(t.a), i = e.offsets.get(t.b);
	if (!r || !i) return;
	let a = !!(e.free[r.offset] && e.free[r.offset + 1]), o = !!(e.free[i.offset] && e.free[i.offset + 1]);
	if (!a && !o) return;
	let s = M(e, t.a), c = M(e, t.b), l = Math.cos(n), u = Math.sin(n), d = (e, t) => {
		let n = e.x - t.x, r = e.y - t.y;
		return {
			x: t.x + n * l - r * u,
			y: t.y + n * u + r * l
		};
	};
	if (a && o) {
		let t = je({
			ax: s.x,
			ay: s.y,
			bx: c.x,
			by: c.y
		}), n = d(s, t), a = d(c, t);
		e.values[r.offset] = n.x, e.values[r.offset + 1] = n.y, e.values[i.offset] = a.x, e.values[i.offset + 1] = a.y;
	} else if (o) {
		let t = d(c, s);
		e.values[i.offset] = t.x, e.values[i.offset + 1] = t.y;
	} else {
		let t = d(s, c);
		e.values[r.offset] = t.x, e.values[r.offset + 1] = t.y;
	}
}
function Ne(e, t, n) {
	let r = n.x - t.x, i = n.y - t.y, a = Math.hypot(r, i);
	return a < 1e-9 ? Math.hypot(e.x - t.x, e.y - t.y) : Math.abs(((e.x - t.x) * i - (e.y - t.y) * r) / a);
}
function Pe(e, t) {
	let n = e.bx - e.ax, r = e.by - e.ay, i = n * n + r * r;
	if (i < 1e-12) return {
		x: e.ax,
		y: e.ay
	};
	let a = ((t.x - e.ax) * n + (t.y - e.ay) * r) / i;
	return {
		x: e.ax + a * n,
		y: e.ay + a * r
	};
}
function Fe(e) {
	let t = e;
	for (; t > Math.PI;) t -= Math.PI * 2;
	for (; t < -Math.PI;) t += Math.PI * 2;
	return t;
}
function Ie(e) {
	return Math.atan2(e.by - e.ay, e.bx - e.ax);
}
function Le(e, t, n, r) {
	let i = n.soft ? r * n.weight : r;
	switch (n.type) {
		case "distance": {
			let t = M(e, n.a), r = M(e, n.b), a = r.x - t.x, o = r.y - t.y, s = Math.hypot(a, o);
			if (s < 1e-9) return;
			let c = (s - n.value) / s * i;
			P(e, n.a, a * c * .5, o * c * .5), P(e, n.b, -a * c * .5, -o * c * .5);
			return;
		}
		case "coincident": {
			let t = M(e, n.a), r = M(e, n.b);
			P(e, n.a, (r.x - t.x) * .5 * i, (r.y - t.y) * .5 * i), P(e, n.b, (t.x - r.x) * .5 * i, (t.y - r.y) * .5 * i);
			return;
		}
		case "midpoint": {
			let t = M(e, n.point), r = M(e, n.a), a = M(e, n.b), o = {
				x: (r.x + a.x) / 2,
				y: (r.y + a.y) / 2
			}, s = e.offsets.get(n.point);
			s && e.free[s.offset] ? P(e, n.point, (o.x - t.x) * i, (o.y - t.y) * i) : (P(e, n.a, (t.x - o.x) * i, (t.y - o.y) * i), P(e, n.b, (t.x - o.x) * i, (t.y - o.y) * i));
			return;
		}
		case "onCircle": {
			let r = M(e, n.point), a = ke(e, t, n.circle), o = N(e, n.circle), s = r.x - a.x, c = r.y - a.y, l = Math.hypot(s, c);
			if (l < 1e-9) return;
			let u = e.offsets.get(n.point);
			if (u && (e.free[u.offset] || e.free[u.offset + 1])) {
				let t = a.x + s / l * o, u = a.y + c / l * o;
				P(e, n.point, (t - r.x) * i, (u - r.y) * i);
			} else Ae(e, n.circle, (l - o) * i);
			return;
		}
		case "onLine": {
			let r = F(e, t.instances.get(n.line));
			if (!r) return;
			let a = M(e, n.point), o = Pe(r, a);
			P(e, n.point, (o.x - a.x) * i, (o.y - a.y) * i);
			return;
		}
		case "perpendicular":
		case "parallel": {
			let r = t.instances.get(n.a), a = t.instances.get(n.b), o = F(e, r), s = F(e, a);
			if (!r || !a || !o || !s) return;
			let c = Ie(o), l = Ie(s), u = Fe((n.type === "perpendicular" ? c + (Math.abs(Fe(l - c - Math.PI / 2)) <= Math.abs(Fe(l - c + Math.PI / 2)) ? Math.PI / 2 : -Math.PI / 2) : c + Math.round((l - c) / Math.PI) * Math.PI) - l);
			Me(e, r, -u * .5 * i), Me(e, a, u * .5 * i);
			return;
		}
		case "equallength": {
			let r = t.instances.get(n.a), a = t.instances.get(n.b), o = F(e, r), s = F(e, a);
			if (!r || !a || !o || !s) return;
			let c = Math.hypot(o.bx - o.ax, o.by - o.ay), l = Math.hypot(s.bx - s.ax, s.by - s.ay), u = (c + l) / 2;
			Re(r, o, c > 1e-9 ? u / c : 1, e, i), Re(a, s, l > 1e-9 ? u / l : 1, e, i);
			return;
		}
		case "horizontal": {
			let r = t.instances.get(n.segment), a = F(e, r);
			if (!r || !a) return;
			let o = (a.ay + a.by) / 2;
			P(e, r.a, 0, (o - a.ay) * i), P(e, r.b, 0, (o - a.by) * i);
			return;
		}
		case "vertical": {
			let r = t.instances.get(n.segment), a = F(e, r);
			if (!r || !a) return;
			let o = (a.ax + a.bx) / 2;
			P(e, r.a, (o - a.ax) * i, 0), P(e, r.b, (o - a.bx) * i, 0);
			return;
		}
		case "tangent": {
			let r = F(e, t.instances.get(n.line)), a = ke(e, t, n.circle), o = N(e, n.circle);
			if (!r) return;
			let s = r.bx - r.ax, c = r.by - r.ay, l = Math.hypot(s, c);
			if (l < 1e-9) return;
			let u = -c / l, d = s / l, f = (a.x - r.ax) * u + (a.y - r.ay) * d, p = f - Math.sign(f || 1) * o, m = e.offsets.get(n.circle);
			m && e.free[m.offset] ? P(e, n.circle, -u * p * i, -d * p * i) : Ae(e, n.circle, Math.abs(f) - o);
			return;
		}
		case "radius":
			Ae(e, n.circle, (n.value - N(e, n.circle)) * i);
			return;
		case "angleat": {
			let t = M(e, n.vertex), r = M(e, n.a), a = M(e, n.b), o = Math.atan2(r.y - t.y, r.x - t.x), s = Math.atan2(a.y - t.y, a.x - t.x), c = Math.abs(Fe(s - o)), l = Fe(n.value - c), u = (e, n) => {
				let r = e.x - t.x, i = e.y - t.y;
				return {
					x: t.x + r * Math.cos(n) - i * Math.sin(n),
					y: t.y + r * Math.sin(n) + i * Math.cos(n)
				};
			}, d = u(r, -l * .5 * i), f = u(a, l * .5 * i);
			P(e, n.a, d.x - r.x, d.y - r.y), P(e, n.b, f.x - a.x, f.y - a.y);
			return;
		}
		case "fixed": return;
	}
}
function Re(e, t, n, r, i) {
	let a = (t.ax + t.bx) / 2, o = (t.ay + t.by) / 2, s = a + (t.ax - a) * (1 + (n - 1) * i), c = o + (t.ay - o) * (1 + (n - 1) * i), l = a + (t.bx - a) * (1 + (n - 1) * i), u = o + (t.by - o) * (1 + (n - 1) * i);
	P(r, e.a, s - t.ax, c - t.ay), P(r, e.b, l - t.bx, u - t.by);
}
function ze(e, t, n) {
	if (t.kind === "point") {
		let r = M(e, t.substanceId);
		P(e, t.substanceId, (t.x - r.x) * n, (t.y - r.y) * n);
	} else {
		let r = N(e, t.substanceId);
		Ae(e, t.substanceId, (t.value - r) * n);
	}
}
function Be(e, t, n) {
	switch (n.type) {
		case "distance": {
			let t = M(e, n.a), r = M(e, n.b);
			return Math.abs(Math.hypot(r.x - t.x, r.y - t.y) - n.value);
		}
		case "coincident": {
			let t = M(e, n.a), r = M(e, n.b);
			return Math.hypot(r.x - t.x, r.y - t.y);
		}
		case "midpoint": {
			let t = M(e, n.point), r = M(e, n.a), i = M(e, n.b);
			return Math.hypot(t.x - (r.x + i.x) / 2, t.y - (r.y + i.y) / 2);
		}
		case "onCircle": {
			let r = M(e, n.point), i = ke(e, t, n.circle);
			return Math.abs(Math.hypot(r.x - i.x, r.y - i.y) - N(e, n.circle));
		}
		case "onLine": {
			let r = F(e, t.instances.get(n.line)), i = M(e, n.point);
			return r ? Ne(i, {
				x: r.ax,
				y: r.ay
			}, {
				x: r.bx,
				y: r.by
			}) : 0;
		}
		case "perpendicular":
		case "parallel": {
			let r = F(e, t.instances.get(n.a)), i = F(e, t.instances.get(n.b));
			if (!r || !i) return 0;
			let a = r.bx - r.ax, o = r.by - r.ay, s = i.bx - i.ax, c = i.by - i.ay, l = Math.hypot(a, o), u = Math.hypot(s, c);
			return l < 1e-9 || u < 1e-9 ? 0 : n.type === "perpendicular" ? Math.abs((a * s + o * c) / (l * u)) : Math.abs((a * c - o * s) / (l * u));
		}
		case "equallength": {
			let r = F(e, t.instances.get(n.a)), i = F(e, t.instances.get(n.b));
			return !r || !i ? 0 : Math.abs(Math.hypot(r.bx - r.ax, r.by - r.ay) - Math.hypot(i.bx - i.ax, i.by - i.ay));
		}
		case "horizontal": {
			let r = F(e, t.instances.get(n.segment));
			return r ? Math.abs(r.ay - r.by) : 0;
		}
		case "vertical": {
			let r = F(e, t.instances.get(n.segment));
			return r ? Math.abs(r.ax - r.bx) : 0;
		}
		case "tangent": {
			let r = F(e, t.instances.get(n.line));
			return r ? Math.abs(Ne(ke(e, t, n.circle), {
				x: r.ax,
				y: r.ay
			}, {
				x: r.bx,
				y: r.by
			}) - N(e, n.circle)) : 0;
		}
		case "radius": return Math.abs(N(e, n.circle) - n.value);
		case "angleat": {
			let t = M(e, n.vertex), r = M(e, n.a), i = M(e, n.b), a = Math.atan2(r.y - t.y, r.x - t.x), o = Math.atan2(i.y - t.y, i.x - t.x);
			return Math.abs(Math.abs(Fe(o - a)) - n.value);
		}
		case "fixed": return 0;
	}
}
function I(e, t) {
	let n = j(e, t.memberPins), r = De(e, t.seeds);
	Oe(n, e, t.seeds);
	let i = !r, a = i ? Math.max(t.iterations, Te) : Math.max(0, t.iterations), o = t.temporary?.length ? [...e.constraints, ...t.temporary] : e.constraints, s = Math.min(1, Math.max(.5, t.config.damping)), c = Math.min(1, Math.max(.05, t.pinTarget?.strength ?? .38));
	for (let r = 0; r < a; r++) {
		t.pinTarget && ze(n, t.pinTarget, c);
		for (let t of o) Le(n, e, t, s);
	}
	let l = o.map((t) => Be(n, e, t)), u = l.reduce((e, t) => Math.max(e, t), 0), d = /* @__PURE__ */ new Map();
	return o.forEach((e, t) => {
		for (let n of Ve(e)) d.set(n, Math.max(d.get(n) ?? 0, Math.min(1, l[t] / 2)));
	}), {
		values: n.values,
		residual: u,
		perConstraint: l,
		stress: d,
		iterations: a,
		dirty: i,
		converged: u <= t.config.convergenceTolerance
	};
}
function Ve(e) {
	switch (e.type) {
		case "distance": return [e.a, e.b];
		case "onCircle": return [e.point, e.circle];
		case "onLine": return [e.point, e.line];
		case "midpoint": return [
			e.point,
			e.a,
			e.b
		];
		case "perpendicular":
		case "parallel":
		case "equallength": return [e.a, e.b];
		case "tangent": return [e.line, e.circle];
		case "coincident": return [e.a, e.b];
		case "horizontal":
		case "vertical": return [e.segment];
		case "radius": return [e.circle];
		case "angleat": return [
			e.vertex,
			e.a,
			e.b
		];
		case "fixed": return [e.point];
	}
}
function L(e, t, n = {}) {
	let r = { ...n };
	for (let n of e.instances.values()) {
		let i = e.bindings[n.id];
		if (!i) continue;
		let a = e.dofs.find((e) => e.instanceId === n.id);
		a && (r[i] = a.kind === "point" ? [He(t[a.offset]), He(t[a.offset + 1])] : [He(t[a.offset])]);
	}
	return r;
}
function He(e) {
	return Math.round(e * 1e6) / 1e6;
}
// src/solver/runtime.ts
var Ue = /* @__PURE__ */ new Map(), We = /* @__PURE__ */ new WeakMap(), Ge = 24;
function R(e) {
	let t = `${e.domainDsl ?? ""}\u0000${e.substanceDsl ?? ""}\u0000${e.styleDsl ?? ""}`, n = Ue.get(t);
	if (n) return n.touched = Date.now(), n.compiled;
	let r = ve(e);
	if (Ue.set(t, {
		compiled: r,
		touched: Date.now()
	}), Ue.size > Ge) {
		let e, t = Infinity;
		for (let [n, r] of Ue) r.touched < t && (t = r.touched, e = n);
		e !== void 0 && Ue.delete(e);
	}
	return r;
}
function Ke() {
	Ue.clear();
}
function qe(e) {
	let t = "";
	for (let [n, r] of e.pinnedDofs) t += `${n}:${r.join(",")};`;
	for (let [n, r] of e.slackWeight) t += `${n}@${r};`;
	return t;
}
function Je(e, t) {
	let n = R(e), r = Ee(n, t), i = e.convergedSeeds ?? {}, a = qe(r), o = We.get(e);
	if (o && o.compiledKey === n.key && o.seeds === i && o.pinsKey === a) return o.solved;
	let s = {
		compiled: n,
		state: n.ok ? I(n, {
			seeds: i,
			memberPins: r,
			config: e.solverConfig,
			iterations: 0
		}) : Xe(),
		seeds: De(n, i) ? i : {},
		pins: r
	};
	return We.set(e, {
		compiledKey: n.key,
		seeds: i,
		pinsKey: a,
		solved: s,
		touched: Date.now()
	}), s;
}
function Ye(e, t, n, r, i, a, o) {
	return I(t, {
		seeds: r,
		memberPins: n,
		config: e.solverConfig,
		iterations: i,
		...a ? { pinTarget: a } : {},
		...o?.length ? { temporary: o } : {}
	});
}
function Xe() {
	return {
		values: /* @__PURE__ */ new Float64Array(),
		residual: 0,
		perConstraint: [],
		stress: /* @__PURE__ */ new Map(),
		iterations: 0,
		dirty: !0,
		converged: !1
	};
}
function Ze(e, t, n) {
	let r = j(e, n);
	r.values.set(t.values);
	let i = 0;
	for (let e of r.free) e && i++;
	let a = e.constraints.map((t) => Be(r, e, t)), o = e.constraints.map((e, t) => ({
		text: e.text,
		residual: a[t],
		line: e.sourceLine
	})).filter((e) => e.residual > .001).sort((e, t) => t.residual - e.residual).slice(0, 12), s = Qe(e, r.values, r.free, n), c = [...t.stress.entries()].map(([e, t]) => ({
		instanceId: e,
		value: t
	})).filter((e) => e.value > .02).sort((e, t) => t.value - e.value).slice(0, 12), l = [];
	return e.errors.length && l.push(`DSL 오류 ${e.errors.length}개`), t.dirty && l.push("시드와 위상이 달라 초기 배치를 계산했습니다."), s >= i && t.residual > .001 && l.push("과구속 가능성이 있습니다. 잔차가 큰 구속을 완화하세요."), {
		totalDofs: i,
		constrainedDofs: s,
		remainingDofs: Math.max(0, i - s),
		residual: t.residual,
		iterations: t.iterations,
		converged: t.converged,
		dirty: t.dirty,
		entityCount: e.instances.size,
		constraintCount: e.constraints.length,
		overConstrained: o,
		stress: c,
		notes: l
	};
}
function Qe(e, t, n, r) {
	let i = [];
	if (n.forEach((e, t) => {
		e && i.push(t);
	}), !i.length || e.constraints.length === 0) return 0;
	if (i.length > 220 || e.constraints.length > 220) {
		let t = e.constraints.reduce((e, t) => e + $e(t), 0);
		return Math.min(i.length, t);
	}
	let a = t.slice(), o = (t) => {
		let n = j(e, r);
		return n.values.set(t), Float64Array.from(e.constraints, (t) => Be(n, e, t));
	}, s = j(e, r);
	s.values.set(t);
	let c = e.constraints.map((t) => Be(s, e, t)), l = [], u = 1e-6;
	for (let n of i) {
		a[n] = t[n] + u;
		let r = o(a);
		a[n] = t[n];
		let i = new Float64Array(e.constraints.length);
		for (let e = 0; e < i.length; e++) i[e] = (r[e] - c[e]) / u;
		l.push(i);
	}
	let d = 0, f = [];
	for (let t = 0; t < e.constraints.length; t++) {
		let e = new Float64Array(i.length);
		for (let n = 0; n < i.length; n++) e[n] = l[n][t];
		let n = Math.hypot(...e);
		if (!(!Number.isFinite(n) || n < 1e-9)) {
			for (let t = 0; t < 2; t++) for (let t of f) {
				let n = e.reduce((e, n, r) => e + n * t[r], 0);
				for (let r = 0; r < e.length; r++) e[r] -= n * t[r];
			}
			if (n = Math.hypot(...e), n > 1e-7) {
				for (let t = 0; t < e.length; t++) e[t] /= n;
				f.push(e), d++;
			}
		}
	}
	return d;
}
function $e(e) {
	return e.type === "midpoint" || e.type === "coincident" ? 2 : 1;
}
// src/geometry.ts
function et(e, t) {
	let n = t.getCanonical(e, "core.transform"), r = t.getCanonical(e, "core.bounds");
	if (n && r) return {
		x: D(n.x, 0),
		y: D(n.y, 0),
		width: O(r.width, 520),
		height: O(r.height, 360),
		rotation: D(n.rotation, 0)
	};
}
function z(e, t, n) {
	let r = e.x + e.width / 2, i = e.y + e.height / 2, a = t - e.width / 2, o = n - e.height / 2, s = Math.cos(e.rotation), c = Math.sin(e.rotation);
	return {
		x: r + a * s - o * c,
		y: i + a * c + o * s
	};
}
function tt(e, t, n) {
	let r = e.x + e.width / 2, i = e.y + e.height / 2, a = t - r, o = n - i, s = Math.cos(-e.rotation), c = Math.sin(-e.rotation);
	return {
		x: e.width / 2 + a * s - o * c,
		y: e.height / 2 + a * c + o * s
	};
}
function nt(e, t, n) {
	let r = Math.cos(e.rotation), i = Math.sin(e.rotation);
	return {
		x: t * r - n * i,
		y: t * i + n * r
	};
}
function rt(e, t, n) {
	let r = j(e, n);
	return t.values.length === r.values.length && r.values.set(t.values), r;
}
function it(e, t, n, r, i) {
	let a = e.instances.get(r.substanceId);
	if (!a) return;
	let o = rt(e, t.state, i), s = e.styles.get(a.id) ?? {}, c = [], l, u = 0, d, f, p, m, h = D(s.fontSize, 14), g = ot(s.label, a.id);
	if (a.kind === "point") {
		let e = M(o, a.id);
		c.push(e), g && (m = {
			x: e.x + 10,
			y: e.y - 10
		}, h = D(s.fontSize, 14));
	} else if (a.kind === "segment" || a.kind === "line" || a.kind === "ray") {
		let e = st(o, a);
		if (!e) return;
		if (a.kind === "segment") c.push(e[0], e[1]);
		else {
			let t = pt(e[0], e[1], {
				x: 0,
				y: 0,
				width: n.width,
				height: n.height
			}, a.kind === "ray");
			c.push(t[0], t[1]);
		}
		if (g) {
			let t = {
				x: (e[0].x + e[1].x) / 2,
				y: (e[0].y + e[1].y) / 2
			}, n = e[1].x - e[0].x, r = e[1].y - e[0].y, i = Math.hypot(n, r) || 1;
			m = {
				x: t.x - r / i * 13,
				y: t.y + n / i * 13
			}, h = D(s.fontSize, 14);
		}
	} else if (a.kind === "circle") l = M(o, a.center ?? ""), u = N(o, a.id), g && (m = {
		x: l.x,
		y: l.y - u - 12
	}, h = D(s.fontSize, 14));
	else if (a.kind === "arc") l = M(o, a.center ?? ""), u = N(o, a.id), d = a.startAngle ?? 0, f = a.endAngle ?? Math.PI, c.push({
		x: l.x + Math.cos(d) * u,
		y: l.y + Math.sin(d) * u
	}, {
		x: l.x + Math.cos(f) * u,
		y: l.y + Math.sin(f) * u
	}), g && (m = {
		x: l.x,
		y: l.y - u - 12
	}, h = D(s.fontSize, 14));
	else if (a.kind === "polygon") {
		let e = a.points ?? [];
		for (let t of e) c.push(M(o, t));
		if (g && c.length) {
			let e = c.reduce((e, t) => ({
				x: e.x + t.x / c.length,
				y: e.y + t.y / c.length
			}), {
				x: 0,
				y: 0
			});
			m = {
				x: e.x,
				y: e.y - 12
			}, h = D(s.fontSize, 14);
		}
	} else if (a.kind === "angle-mark") {
		let [e, t, n] = a.angle ?? [];
		if (!e || !t || !n) return;
		let r = M(o, e), i = M(o, t), _ = M(o, n);
		c.push(r, i, _);
		let v = ut(r, i, _, D(s.radius, 22));
		if (l = i, u = v.radius, d = v.start, f = v.end, g) {
			let e = ft(r, i, _);
			m = {
				x: i.x + e.x * (v.radius + 14),
				y: i.y + e.y * (v.radius + 14)
			}, p = s.label === !0 ? `${Math.round(v.degrees)}°` : g, h = D(s.fontSize, 13);
		}
	} else if (a.kind === "label-anchor") {
		let t = a.label;
		if (!t) return;
		let n = ct(o, e, t.anchor);
		if (!n) return;
		let r = lt(o, e, t);
		p = t.text, m = {
			x: n.point.x + r.x,
			y: n.point.y + r.y
		}, h = D(s.fontSize, 15);
	}
	let _ = p ?? g, v = c.map((e) => z(n, e.x, e.y)), y = l ? z(n, l.x, l.y) : void 0, b = m ? z(n, m.x, m.y) : void 0, x = u, ee = d === void 0 ? void 0 : d + n.rotation, S = f === void 0 ? void 0 : f + n.rotation, C = at(e, o, a, n), te = mt({
		kind: a.kind,
		points: v,
		...y ? { center: y } : {},
		radius: a.kind === "circle" || a.kind === "arc" || a.kind === "angle-mark" ? x : 0,
		..._ ? { text: _ } : {},
		...b ? { textPoint: b } : {},
		textSize: h,
		style: s
	}), ne = e.badges.ticks.get(a.id) ?? 0, w = e.badges.rightAngles.some((e) => e.a === a.id || e.b === a.id), re = e.pinned.has(a.id) || (r.pinnedDofs?.length ?? 0) > 0, T = e.badges.onCircle.has(a.id);
	return {
		...te,
		kind: a.kind,
		name: a.id,
		style: s,
		points: v,
		...y ? { center: y } : {},
		...x > 0 ? { radius: x } : {},
		...ee === void 0 ? {} : { startAngle: ee },
		...S === void 0 ? {} : { endAngle: S },
		..._ ? { text: _ } : {},
		...b ? {
			textX: b.x,
			textY: b.y
		} : {},
		textSize: h,
		squares: C,
		stress: t.state.stress.get(a.id) ?? 0,
		badges: {
			ticks: ne,
			rightAngle: w,
			pinned: re,
			onCircle: T
		}
	};
}
function at(e, t, n, r) {
	let i = [], a = (e, t) => B({
		x: t.x - e.x,
		y: t.y - e.y
	});
	if (n.kind === "angle-mark" && n.angle) {
		let [e, o, s] = n.angle, c = M(t, e), l = M(t, o), u = M(t, s), d = a(l, c), f = a(l, u);
		if (Math.abs(d.x * f.x + d.y * f.y) < .02) {
			let e = z(r, l.x, l.y), t = nt(r, d.x, d.y), n = nt(r, f.x, f.y);
			i.push({
				x: e.x,
				y: e.y,
				ax: t.x,
				ay: t.y,
				bx: n.x,
				by: n.y,
				size: 9
			});
		}
		return i;
	}
	if (n.kind !== "segment" && n.kind !== "line" && n.kind !== "ray") return i;
	for (let o of e.badges.rightAngles) {
		if (o.a !== n.id && o.b !== n.id) continue;
		let s = e.instances.get(o.a), c = e.instances.get(o.b), l = s ? st(t, s) : void 0, u = c ? st(t, c) : void 0;
		if (!s || !c || !l || !u) continue;
		let d = [s.a, s.b].find((e) => e === c.a || e === c.b);
		if (!d) continue;
		let f = s.a === d ? s.b : s.a, p = c.a === d ? c.b : c.a;
		if (!f || !p) continue;
		let m = M(t, d), h = M(t, f), g = M(t, p), _ = a(m, h), v = a(m, g), y = z(r, m.x, m.y), b = nt(r, _.x, _.y), x = nt(r, v.x, v.y);
		i.push({
			x: y.x,
			y: y.y,
			ax: b.x,
			ay: b.y,
			bx: x.x,
			by: x.y,
			size: 9
		});
	}
	return i;
}
function ot(e, t) {
	if (e === !0) return t;
	if (typeof e == "string" && e && e !== "none" && e !== "false") return e;
}
function st(e, t) {
	if (t.a && t.b) return [M(e, t.a), M(e, t.b)];
}
function ct(e, t, n) {
	let r = t.instances.get(n.id);
	if (!r) return;
	if (n.kind === "point") return {
		point: M(e, n.id),
		direction: {
			x: 0,
			y: -1
		}
	};
	if (n.kind === "center") {
		if (r.kind === "circle" || r.kind === "arc") return {
			point: M(e, r.center ?? ""),
			direction: {
				x: 0,
				y: -1
			}
		};
		if (r.kind === "polygon") {
			let t = (r.points ?? []).map((t) => M(e, t));
			return t.length ? {
				point: t.reduce((e, n) => ({
					x: e.x + n.x / t.length,
					y: e.y + n.y / t.length
				}), {
					x: 0,
					y: 0
				}),
				direction: {
					x: 0,
					y: -1
				}
			} : void 0;
		}
		return;
	}
	let i = st(e, r);
	if (!i) return;
	let a = {
		x: (i[0].x + i[1].x) / 2,
		y: (i[0].y + i[1].y) / 2
	}, o = i[1].x - i[0].x, s = i[1].y - i[0].y, c = Math.hypot(o, s) || 1;
	return {
		point: a,
		direction: {
			x: -s / c,
			y: o / c
		}
	};
}
function lt(e, t, n) {
	if (n.offsetMode === "vector") return {
		x: n.offsetX ?? 0,
		y: n.offsetY ?? 0
	};
	let r = ct(e, t, n.anchor)?.direction ?? {
		x: 0,
		y: -1
	}, i = n.offset ?? 12;
	return {
		x: r.x * i,
		y: r.y * i
	};
}
function ut(e, t, n, r) {
	let i = B({
		x: e.x - t.x,
		y: e.y - t.y
	}), a = B({
		x: n.x - t.x,
		y: n.y - t.y
	}), o = Math.max(6, Math.min(O(r, 22), Math.min(Math.hypot(e.x - t.x, e.y - t.y), Math.hypot(n.x - t.x, n.y - t.y)) * .42)), s = Math.atan2(i.y, i.x), c = Math.atan2(a.y, a.x) - s, l = Math.abs(dt(c));
	return {
		radius: o,
		start: s,
		end: s + (c >= 0 ? l : -l),
		degrees: l * 180 / Math.PI
	};
}
function dt(e) {
	let t = e;
	for (; t > Math.PI;) t -= Math.PI * 2;
	for (; t < -Math.PI;) t += Math.PI * 2;
	return t;
}
function B(e) {
	let t = Math.hypot(e.x, e.y) || 1;
	return {
		x: e.x / t,
		y: e.y / t
	};
}
function ft(e, t, n) {
	let r = B({
		x: e.x - t.x,
		y: e.y - t.y
	}), i = B({
		x: n.x - t.x,
		y: n.y - t.y
	});
	return B({
		x: r.x + i.x,
		y: r.y + i.y
	});
}
function pt(e, t, n, r) {
	let i = t.x - e.x, a = t.y - e.y, o = [
		-i,
		i,
		-a,
		a
	], s = [
		e.x - n.x,
		n.x + n.width - e.x,
		e.y - n.y,
		n.y + n.height - e.y
	], c = r ? 0 : -Infinity, l = Infinity;
	for (let n = 0; n < 4; n++) {
		let r = o[n], i = s[n];
		if (Math.abs(r) < 1e-12) {
			if (i < 0) return [e, t];
			continue;
		}
		let a = i / r;
		if (r < 0) {
			if (a > l) return [e, t];
			a > c && (c = a);
		} else {
			if (a < c) return [e, t];
			a < l && (l = a);
		}
	}
	return !Number.isFinite(c) || !Number.isFinite(l) || l <= c ? r ? [e, {
		x: e.x + i,
		y: e.y + a
	}] : [e, t] : [{
		x: e.x + i * c,
		y: e.y + a * c
	}, {
		x: e.x + i * l,
		y: e.y + a * l
	}];
}
function mt(e) {
	let t = Infinity, n = Infinity, r = -Infinity, i = -Infinity, a = (e, a) => {
		e < t && (t = e), a < n && (n = a), e > r && (r = e), a > i && (i = a);
	};
	for (let t of e.points) a(t.x, t.y);
	if (e.center && e.radius > 0 && (a(e.center.x - e.radius, e.center.y - e.radius), a(e.center.x + e.radius, e.center.y + e.radius)), e.text && e.textPoint) {
		let t = ht(e.text, e.textSize);
		a(e.textPoint.x - t / 2, e.textPoint.y - e.textSize * .75), a(e.textPoint.x + t / 2, e.textPoint.y + e.textSize * .75);
	}
	Number.isFinite(t) || (t = 0, n = 0, r = 0, i = 0);
	let o = e.kind === "point" ? Math.max(3, O(e.style.r, 4.5) + 2) : 2;
	return {
		x: t - o,
		y: n - o,
		width: Math.max(1, r - t + o * 2),
		height: Math.max(1, i - n + o * 2),
		rotation: 0
	};
}
function ht(e, t) {
	let n = 0;
	for (let t of e) {
		let e = t.codePointAt(0) ?? 0;
		n += e >= 11904 ? 1 : e === 32 ? .32 : .56;
	}
	return n * t;
}
function V(e, t) {
	return Math.hypot(e.x - t.x, e.y - t.y);
}
function gt(e, t, n) {
	let r = n.x - t.x, i = n.y - t.y, a = r * r + i * i;
	if (a < 1e-12) return V(e, t);
	let o = ie(((e.x - t.x) * r + (e.y - t.y) * i) / a, 0, 1);
	return V(e, {
		x: t.x + o * r,
		y: t.y + o * i
	});
}
function _t(e, t, n) {
	let r = n.x - t.x, i = n.y - t.y, a = r * r + i * i;
	if (a < 1e-12) return V(e, t);
	let o = ((e.x - t.x) * r + (e.y - t.y) * i) / a;
	return o <= 0 ? V(e, t) : V(e, {
		x: t.x + o * r,
		y: t.y + o * i
	});
}
function vt(e, t, n) {
	let r = n.x - t.x, i = n.y - t.y, a = Math.hypot(r, i);
	return a < 1e-12 ? V(e, t) : Math.abs((e.x - t.x) * (n.y - t.y) - (e.y - t.y) * (n.x - t.x)) / a;
}
function yt(e, t) {
	let n = !1;
	for (let r = 0, i = t.length - 1; r < t.length; i = r++) {
		let a = t[r], o = t[i];
		a.y > e.y != o.y > e.y && e.x < (o.x - a.x) * (e.y - a.y) / (o.y - a.y) + a.x && (n = !n);
	}
	return n;
}
function bt(e, t, n) {
	let r = (e) => {
		let t = e;
		for (; t > Math.PI;) t -= Math.PI * 2;
		for (; t < -Math.PI;) t += Math.PI * 2;
		return t;
	}, i = r(n - t), a = r(e - t);
	return i >= 0 ? a >= 0 && a <= i : a <= 0 && a >= i;
}
// src/render/member.ts
var xt = "system-ui,-apple-system,'Segoe UI','Noto Sans KR',sans-serif", St = "ui-monospace,SFMono-Regular,Menlo,monospace", Ct = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|none|transparent|currentcolor|[a-z]{3,20})$/i;
function H(e) {
	return String(e).replace(/[&<>"']/g, (e) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&apos;"
	})[e]);
}
function U(e, t) {
	return typeof e == "string" && Ct.test(e.trim()) ? e.trim() : t;
}
function W(e, t, n = -Infinity, r = Infinity) {
	return typeof e == "number" && Number.isFinite(e) ? Math.min(r, Math.max(n, e)) : t;
}
function G(e) {
	let t = Math.round(e * 1e3) / 1e3;
	return Number.isFinite(t) ? String(t) : "0";
}
function wt(e) {
	return e.map((e) => `${G(e.x)},${G(e.y)}`).join(" ");
}
function Tt(e) {
	let t = e.style, n = U(t.stroke, "#475569"), r = U(t.fill, e.kind === "point" ? "#2563eb" : "none"), i = W(t.width, 2, 0, 24), a = W(t.dash, 0, 0, 80), o = `fill="${H(r)}" stroke="${H(n)}" stroke-width="${G(i)}"${a > 0 ? ` stroke-dasharray="${G(a)} ${G(a * 1.6)}"` : ""} stroke-linecap="round" stroke-linejoin="round"`, s = [];
	if (e.kind === "point") {
		let r = e.points[0];
		if (!r) return "";
		let i = W(t.r, 4.5, .5, 40);
		s.push(`<circle cx="${G(r.x)}" cy="${G(r.y)}" r="${G(i)}" ${o}/>`), e.badges.pinned && s.push(`<circle cx="${G(r.x)}" cy="${G(r.y)}" r="${G(i + 3.5)}" fill="none" stroke="${H(U(t.stroke, "#1d4ed8"))}" stroke-width="1" stroke-dasharray="1.5 2"/>`), e.badges.onCircle && s.push(`<circle cx="${G(r.x)}" cy="${G(r.y)}" r="${G(i + 1.5)}" fill="none" stroke="${H(n)}" stroke-opacity="0.35" stroke-width="0.8"/>`);
	} else if (e.kind === "segment" || e.kind === "line" || e.kind === "ray") {
		let [r, a] = e.points;
		if (!r || !a) return "";
		if (s.push(`<line x1="${G(r.x)}" y1="${G(r.y)}" x2="${G(a.x)}" y2="${G(a.y)}" ${o}/>`), e.kind !== "segment") {
			let e = At(a, r, Math.max(6, i * 3));
			s.push(`<path d="${e}" fill="${H(n)}" stroke="none"/>`);
		}
		e.badges.ticks > 0 && t.ticks !== !1 && s.push(Et(r, a, e.badges.ticks, n, Math.max(1, i)));
	} else if (e.kind === "circle") {
		if (!e.center) return "";
		s.push(`<circle cx="${G(e.center.x)}" cy="${G(e.center.y)}" r="${G(e.radius ?? 0)}" ${o}/>`);
	} else if (e.kind === "arc") {
		if (!e.center || !((e.radius ?? 0) > 0)) return "";
		s.push(`<path d="${jt(e.center, e.radius ?? 0, e.startAngle ?? 0, e.endAngle ?? Math.PI)}" fill="none" stroke="${H(n)}" stroke-width="${G(i)}"${a > 0 ? ` stroke-dasharray="${G(a)} ${G(a * 1.6)}"` : ""} stroke-linecap="round"/>`);
	} else if (e.kind === "polygon") {
		if (e.points.length < 3) return "";
		s.push(`<polygon points="${wt(e.points)}" ${o}/>`);
	} else if (e.kind === "angle-mark") {
		let [, n] = e.points;
		if (!n || !((e.radius ?? 0) > 0)) return "";
		let r = U(t.stroke, "#f59e0b");
		s.push(`<path d="${jt(n, e.radius ?? 0, e.startAngle ?? 0, e.endAngle ?? Math.PI)}" fill="none" stroke="${H(r)}" stroke-width="${G(i)}" stroke-linecap="round"/>`);
		let a = e.points[0], o = e.points[2];
		if (a && o) {
			let e = (a.x - n.x) * (o.x - n.x) + (a.y - n.y) * (o.y - n.y), t = Math.hypot(a.x - n.x, a.y - n.y) * Math.hypot(o.x - n.x, o.y - n.y);
			t > 0 && Math.abs(e / t) < .02 && s.push(Dt(n, a, o, 9, r, i));
		}
	} else e.kind;
	for (let t of e.squares) s.push(Ot(t, n, Math.max(1, i)));
	if (e.stress > .18 && s.push(Nt(e)), e.text && e.textX !== void 0 && e.textY !== void 0) {
		let n = W(e.textSize, 14, 6, 96), r = U(t.fill, "#334155"), i = e.kind === "label-anchor" ? "none" : U(t.labelBackground, "none");
		if (i !== "none") {
			let t = ht(e.text, n) + 8;
			s.push(`<rect x="${G(e.textX - t / 2)}" y="${G(e.textY - n * .72)}" width="${G(t)}" height="${G(n * 1.44)}" rx="3" fill="${H(i)}"/>`);
		}
		s.push(`<text x="${G(e.textX)}" y="${G(e.textY)}" text-anchor="middle" dominant-baseline="middle" font-family="${e.textSize && e.textSize < 10 ? St : xt}" font-size="${G(n)}" font-weight="${W(t.fontWeight, 500, 100, 900)}" fill="${H(r)}" stroke="none">${H(e.text)}</text>`);
	}
	return s.join("");
}
function Et(e, t, n, r, i) {
	let a = t.x - e.x, o = t.y - e.y, s = Math.hypot(a, o);
	if (s < 1e-6) return "";
	let c = a / s, l = o / s, u = -l, d = c, f = (e.x + t.x) / 2, p = (e.y + t.y) / 2, m = Math.min(3, Math.max(1, Math.trunc(n))), h = [];
	for (let e = 0; e < m; e++) {
		let t = (e - (m - 1) / 2) * 5, n = f + c * t, a = p + l * t;
		h.push(`<line x1="${G(n - u * 5)}" y1="${G(a - d * 5)}" x2="${G(n + u * 5)}" y2="${G(a + d * 5)}" stroke="${H(r)}" stroke-width="${G(i)}" stroke-linecap="round"/>`);
	}
	return h.join("");
}
function Dt(e, t, n, r, i, a) {
	let o = kt(e, t), s = kt(e, n), c = {
		x: e.x + o.x * r,
		y: e.y + o.y * r
	}, l = {
		x: c.x + s.x * r,
		y: c.y + s.y * r
	}, u = {
		x: e.x + s.x * r,
		y: e.y + s.y * r
	};
	return `<path d="M ${G(c.x)} ${G(c.y)} L ${G(l.x)} ${G(l.y)} L ${G(u.x)} ${G(u.y)}" fill="none" stroke="${H(i)}" stroke-width="${G(a)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function Ot(e, t, n) {
	let r = {
		x: e.x + e.ax * e.size,
		y: e.y + e.ay * e.size
	}, i = {
		x: r.x + e.bx * e.size,
		y: r.y + e.by * e.size
	}, a = {
		x: e.x + e.bx * e.size,
		y: e.y + e.by * e.size
	};
	return `<path d="M ${G(r.x)} ${G(r.y)} L ${G(i.x)} ${G(i.y)} L ${G(a.x)} ${G(a.y)}" fill="none" stroke="${H(t)}" stroke-width="${G(n)}" stroke-linejoin="round"/>`;
}
function kt(e, t) {
	let n = t.x - e.x, r = t.y - e.y, i = Math.hypot(n, r) || 1;
	return {
		x: n / i,
		y: r / i
	};
}
function At(e, t, n) {
	let r = Math.atan2(e.y - t.y, e.x - t.x), i = {
		x: e.x - n * Math.cos(r - .42),
		y: e.y - n * Math.sin(r - .42)
	}, a = {
		x: e.x - n * Math.cos(r + .42),
		y: e.y - n * Math.sin(r + .42)
	};
	return `M ${G(e.x)} ${G(e.y)} L ${G(i.x)} ${G(i.y)} L ${G(a.x)} ${G(a.y)} Z`;
}
function jt(e, t, n, r) {
	let i = Mt(r - n), a = {
		x: e.x + Math.cos(n) * t,
		y: e.y + Math.sin(n) * t
	}, o = {
		x: e.x + Math.cos(n + i) * t,
		y: e.y + Math.sin(n + i) * t
	}, s = +(Math.abs(i) > Math.PI), c = +(i >= 0);
	return `M ${G(a.x)} ${G(a.y)} A ${G(t)} ${G(t)} 0 ${s} ${c} ${G(o.x)} ${G(o.y)}`;
}
function Mt(e) {
	let t = e;
	for (; t > Math.PI;) t -= Math.PI * 2;
	for (; t < -Math.PI;) t += Math.PI * 2;
	return t;
}
function Nt(e) {
	let t = e.center ?? e.points[0] ?? (e.textX === void 0 ? void 0 : {
		x: e.textX,
		y: e.textY ?? 0
	});
	if (!t) return "";
	let n = e.kind === "point" ? W(e.style.r, 4.5) + 6 : 15;
	return `<circle cx="${G(t.x)}" cy="${G(t.y)}" r="${G(n)}" fill="none" stroke="#FF4800" stroke-width="4" stroke-opacity="${G(.25 + e.stress * .5)}" stroke-dasharray="2 5"/>`;
}
// src/aspects.ts
function Pt(e, t, n) {
	let i = n.getCanonical(e.scopeId, r);
	if (!i) return;
	let a = et(e.scopeId, n);
	if (!a) return;
	let o = Je(i, n);
	if (o.compiled.ok) return it(o.compiled, o, a, e, o.pins);
}
var Ft = {
	id: r,
	label: "Kite 스코프",
	summary: "Kite 다이어그램의 Domain · Substance · Style 정본과 수렴 시드를 보관합니다.",
	defaults: g(),
	textFields: [
		"domainDsl",
		"substanceDsl",
		"styleDsl"
	],
	textSearchFields: ["substanceDsl"],
	dependsOnCanonical: [
		r,
		"core.transform",
		"core.bounds"
	],
	dependsOnComputed: [],
	renderSvg: () => ({ svg: "" })
}, It = {
	id: i,
	label: "Kite 멤버",
	summary: "스코프 솔버가 계산한 점 · 선분 · 원 · 호 · 다각형 · 각도 · 라벨입니다.",
	defaults: {
		scopeId: "",
		substanceId: "",
		primitiveKind: "point",
		pinnedDofs: [],
		slackWeight: 1
	},
	refs: { scopeId: "cascade-hide" },
	textFields: [],
	textSearchFields: ["substanceId"],
	dependsOnCanonical: [
		i,
		r,
		"core.transform",
		"core.bounds"
	],
	dependsOnComputed: [],
	layout: !0,
	paintOverflow: 8,
	derive: Pt,
	renderSvg(e, t) {
		return t ? { svg: Tt(t) } : { svg: "" };
	},
	selection: {
		getBounds(e, t, n) {
			let r = t.getComputed(e, `computed.${i}`);
			return r ? (n.x = r.x, n.y = r.y, n.width = r.width, n.height = r.height, n.rotation = 0, !0) : !1;
		},
		hitTest(e, t, n, r, a) {
			let o = t.getComputed(e, `computed.${i}`);
			if (!o || n < o.x - 4 / a || r < o.y - 4 / a || n > o.x + o.width + 4 / a || r > o.y + o.height + 4 / a) return Infinity;
			let s = {
				x: n,
				y: r
			};
			switch (o.kind) {
				case "point": {
					let e = o.points[0];
					if (!e) return Infinity;
					let t = typeof o.style.r == "number" ? o.style.r : 4.5;
					return Math.max(0, V(s, e) - t);
				}
				case "segment": return o.points[0] && o.points[1] ? gt(s, o.points[0], o.points[1]) : Infinity;
				case "ray": return o.points[0] && o.points[1] ? _t(s, o.points[0], o.points[1]) : Infinity;
				case "line": return o.points[0] && o.points[1] ? vt(s, o.points[0], o.points[1]) : Infinity;
				case "circle": return o.center ? Math.abs(V(s, o.center) - (o.radius ?? 0)) : Infinity;
				case "arc": {
					if (!o.center) return Infinity;
					if (bt(Math.atan2(r - o.center.y, n - o.center.x), o.startAngle ?? 0, o.endAngle ?? Math.PI)) return Math.abs(V(s, o.center) - (o.radius ?? 0));
					let [e, t] = o.points;
					return Math.min(e ? V(s, e) : Infinity, t ? V(s, t) : Infinity);
				}
				case "polygon": {
					if (o.points.length < 2) return Infinity;
					if (yt(s, o.points)) return 0;
					let e = Infinity;
					for (let t = 0; t < o.points.length; t++) e = Math.min(e, gt(s, o.points[t], o.points[(t + 1) % o.points.length]));
					return e;
				}
				case "angle-mark": {
					let e = o.points[1];
					return e ? o.radius && o.radius > 0 && bt(Math.atan2(r - e.y, n - e.x), o.startAngle ?? 0, o.endAngle ?? Math.PI) ? Math.abs(V(s, e) - o.radius) : V(s, e) : Infinity;
				}
				case "label-anchor": return o.textX !== void 0 && o.textY !== void 0 ? V(s, {
					x: o.textX,
					y: o.textY
				}) : Infinity;
			}
		},
		intersectsRect(e, t, n, r, a, o) {
			let s = t.getComputed(e, `computed.${i}`);
			return !!s && s.x <= a && s.y <= o && s.x + s.width >= n && s.y + s.height >= r;
		},
		canTransform: () => !1
	},
	ui: { controls: [{
		id: `${i}.add-constraint`,
		kind: "action",
		label: "Kite 구속 추가",
		placement: "selection-bar",
		commandSymbol: l.addConstraint,
		requiresSelection: !0
	}, {
		id: `${i}.reproject`,
		kind: "action",
		label: "Kite 다시 수렴",
		placement: "selection-bar",
		commandSymbol: l.reproject,
		requiresSelection: !0
	}] }
}, Lt = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function Rt() {
	let e = globalThis.crypto?.randomUUID?.();
	return e ? e.replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
}
function zt(e) {
	let t = e + 1, n = "";
	for (; t > 0;) n = Lt[(t - 1) % 61] + n, t = Math.floor((t - 1) / 61);
	return `V${n}`;
}
function Bt(e) {
	return e.services.get("canvas.active-tool-surface")?.get();
}
function Vt(e) {
	let t = Bt(e);
	if (t) return [...t.selection.getSelection()];
	let n = e.services.get("canvas.selection");
	return n?.getSelection ? [...n.getSelection()] : [];
}
function Ht(e, t) {
	let n = Bt(e);
	if (n) {
		n.selection.select(t);
		return;
	}
	let r = e.services.get("canvas.selection");
	r?.select && r.select(t);
}
function K(e, t) {
	let n = t ? [t] : Vt(e);
	for (let t of n) {
		let n = e.world.getCanonical(t, r);
		if (n) return {
			scopeId: t,
			scope: v(n)
		};
		let a = e.world.getCanonical(t, i);
		if (a?.scopeId) {
			let t = e.world.getCanonical(a.scopeId, r);
			if (t) return {
				scopeId: a.scopeId,
				scope: v(t)
			};
		}
	}
}
function Ut(e, t) {
	let n = Bt(e)?.host.history ?? e.services.get("canvas.interaction")?.history;
	n?.begin();
	try {
		let e = t();
		return n?.commit(), e;
	} catch (e) {
		throw n?.abort(), e;
	}
}
function Wt(e) {
	let t = Bt(e), n = t?.surface.element ?? e.services.get("canvas.surface")?.element, r = t?.host ?? e.services.get("canvas.interaction");
	if (!n || !r?.screenToWorld) return {
		x: 0,
		y: 0
	};
	let i = n.getBoundingClientRect(), a = {
		x: 0,
		y: 0
	};
	return r.screenToWorld(i.left + i.width / 2, i.top + i.height / 2, a), a;
}
function q(e) {
	let t = ve(e);
	if (!t.ok) {
		let e = t.errors.slice(0, 5).map((e) => `L${e.line}: ${e.message}`).join("\n");
		throw Error(`Kite DSL 오류\n${e}`);
	}
	return t;
}
function Gt(e, t, n) {
	let r = `${t}_${n.toString(36)}`, i = r, a = 0;
	for (; e.world.isAlive(i);) a++, i = `${r}_${a}`;
	return i;
}
function Kt(e, t, n, r) {
	let a = {}, o = [], s = /* @__PURE__ */ new Set(), c = 0;
	for (let l of n.instances.values()) {
		let n = r[l.id], u = n && e.world.isAlive(n) && e.world.getCanonical(n, "kite.member") ? n : void 0;
		u && s.has(u) && (u = void 0), u ||= Gt(e, t, c), s.add(u), a[l.id] = u;
		let d = e.world.getCanonical(u, i);
		d && d.primitiveKind === l.kind && d.substanceId === l.id && d.scopeId === t || o.push({
			id: u,
			aspect: i,
			patch: {
				...d ?? {},
				scopeId: t,
				substanceId: l.id,
				primitiveKind: l.kind,
				...d ? {} : {
					pinnedDofs: [],
					slackWeight: 1
				}
			}
		}), e.world.getCanonical(u, "core.stacking") || o.push({
			id: u,
			aspect: "core.stacking",
			patch: { order: zt(c) }
		}), c++;
	}
	for (let [t, a] of Object.entries(r)) !n.instances.has(t) && !s.has(a) && e.world.isAlive(a) && o.push({
		id: a,
		aspect: i,
		patch: null
	});
	return {
		bindings: a,
		ops: o
	};
}
function qt(e) {
	let t = `ent_kite_${Rt()}`, n = Wt(e), i = {
		...g(),
		entityBindings: {},
		convergedSeeds: {}
	}, { bindings: a, ops: o } = Kt(e, t, q(i), {}), s = q({
		...i,
		entityBindings: a
	}), c = L(s, I(s, {
		seeds: {},
		memberPins: {
			pinnedDofs: /* @__PURE__ */ new Map(),
			slackWeight: /* @__PURE__ */ new Map()
		},
		config: i.solverConfig,
		iterations: 240
	}).values), u = [
		{
			id: t,
			aspect: "core.transform",
			patch: {
				x: n.x - 260,
				y: n.y - 180,
				rotation: 0
			}
		},
		{
			id: t,
			aspect: "core.bounds",
			patch: {
				width: 520,
				height: 360
			}
		},
		{
			id: t,
			aspect: "core.stacking",
			patch: { order: "V" }
		},
		{
			id: t,
			aspect: r,
			patch: {
				...i,
				entityBindings: a,
				convergedSeeds: c
			}
		},
		...o
	];
	return Ut(e, () => {
		e.world.applyCanonicalTransaction(l.insert, u, "local:user");
	}), Ht(e, t), Bt(e)?.host.requestRender(), t;
}
function J(e, t = {}) {
	let n = K(e, t.entityId);
	if (!n) throw Error("Kite 스코프를 선택하세요.");
	let i = v({
		...n.scope,
		...typeof t.domainDsl == "string" ? { domainDsl: t.domainDsl } : {},
		...typeof t.substanceDsl == "string" ? { substanceDsl: t.substanceDsl } : {},
		...typeof t.styleDsl == "string" ? { styleDsl: t.styleDsl } : {},
		solverConfig: _({
			...n.scope.solverConfig,
			...t.solverConfig ?? {}
		})
	}), a = q(i), { bindings: o, ops: s } = Kt(e, n.scopeId, a, n.scope.entityBindings), c = q({
		...i,
		entityBindings: o
	}), u = I(c, {
		seeds: {},
		memberPins: {
			pinnedDofs: /* @__PURE__ */ new Map(),
			slackWeight: /* @__PURE__ */ new Map()
		},
		config: i.solverConfig,
		iterations: 240
	}), d = L(c, u.values), f = {
		schemaVersion: 1,
		domainDsl: i.domainDsl,
		substanceDsl: i.substanceDsl,
		styleDsl: i.styleDsl,
		solverConfig: i.solverConfig,
		entityBindings: o,
		convergedSeeds: d
	};
	return Ut(e, () => {
		e.world.applyCanonicalTransaction(l.apply, [...s, {
			id: n.scopeId,
			aspect: r,
			patch: f
		}], "local:user");
	}), Bt(e)?.host.requestRender(), {
		scopeId: n.scopeId,
		residual: u.residual,
		seeds: d,
		errors: []
	};
}
function Jt(e, t = {}) {
	let n = g();
	return J(e, {
		entityId: t.entityId,
		domainDsl: n.domainDsl,
		substanceDsl: n.substanceDsl,
		styleDsl: n.styleDsl,
		solverConfig: n.solverConfig
	});
}
function Yt(e, t) {
	let n = 1;
	for (; e.instances.has(`${t}${n}`);) n++;
	return `${t}${n}`;
}
function Xt(e, t) {
	return `${e.substanceDsl.replace(/\s*$/, "")}\n${t}\n`;
}
function Zt(e) {
	let t = e.split(/\r?\n/), n = [];
	for (let e of t) {
		let t = e.trim();
		!t || t.startsWith("#") ? n.push(e) : /^(soft\s+)?[A-Za-z_]\w*\s*\(/.test(t) || /^(pin|unpin)\s+/.test(t) || (/^[A-Za-z_]\w*\s+[A-Za-z_]\w*\s*=\s*\(/.test(t) && !/\spin\s*$/.test(t) ? n.push(`${e.trimEnd()} pin`) : n.push(e));
	}
	return `${n.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
function Qt(e) {
	return `${t}:${e}`;
}
function $t(e, t, n, i = "manipulate") {
	Ut(e, () => {
		e.world.applyCanonicalTransaction(Qt(i), [{
			id: t,
			aspect: r,
			patch: n
		}], "local:user");
	});
}
// src/commands.ts
function en(e) {
	let t = K(e);
	if (!t) return [];
	let n = [];
	for (let r of Vt(e)) {
		let a = e.world.getCanonical(r, i);
		a?.scopeId === t.scopeId && a.substanceId && n.push({
			entityId: r,
			scopeId: a.scopeId,
			substanceId: a.substanceId,
			kind: a.primitiveKind
		});
	}
	return n;
}
function Y(e) {
	let t = en(e);
	if (!t.length) throw Error("Kite 멤버를 먼저 선택하세요.");
	let n = t[0].scopeId;
	if (t.some((e) => e.scopeId !== n)) throw Error("같은 Kite 스코프의 멤버만 선택하세요.");
	return t;
}
function tn(e, t) {
	return e.find((e) => e.kind === t);
}
function X(e) {
	return e.filter((e) => e.kind === "segment" || e.kind === "line" || e.kind === "ray");
}
function Z(e, t) {
	let n = K(e);
	if (!n) throw Error("Kite 스코프를 선택하세요.");
	let r = v(n.scope);
	if (r.substanceDsl.includes(t)) throw Error(`이미 같은 구속이 있습니다: ${t}`);
	return J(e, {
		entityId: n.scopeId,
		substanceDsl: Xt(r, t)
	});
}
function nn(e) {
	let t = Y(e), n = tn(t, "point"), r = tn(t, "circle");
	if (!n || !r) throw Error("점 하나와 원 하나를 선택하세요.");
	return Z(e, `OnCircle(${n.substanceId}, ${r.substanceId})`);
}
function rn(e) {
	let t = Y(e), n = t.filter((e) => e.kind === "point"), r = X(t)[0];
	if (n.length === 3) return Z(e, `Midpoint(${n[0].substanceId}, ${n[1].substanceId}, ${n[2].substanceId})`);
	if (n.length === 1 && r) {
		let t = q(v(K(e).scope)).instances.get(r.substanceId);
		if (!t?.a || !t.b) throw Error("선분의 두 끝점을 찾을 수 없습니다.");
		return Z(e, `Midpoint(${n[0].substanceId}, ${t.a}, ${t.b})`);
	}
	throw Error("점 3개, 또는 점 하나와 선분 하나를 선택하세요.");
}
function an(e) {
	let t = X(Y(e));
	if (t.length !== 2) throw Error("선분 두 개를 선택하세요.");
	return Z(e, `Perpendicular(${t[0].substanceId}, ${t[1].substanceId})`);
}
function on(e) {
	let t = X(Y(e));
	if (t.length !== 2) throw Error("선분 두 개를 선택하세요.");
	return Z(e, `EqualLength(${t[0].substanceId}, ${t[1].substanceId})`);
}
function sn(e) {
	let t = X(Y(e))[0];
	if (!t) throw Error("선분 하나를 선택하세요.");
	return Z(e, `Horizontal(${t.substanceId})`);
}
function cn(e) {
	let t = X(Y(e))[0];
	if (!t) throw Error("선분 하나를 선택하세요.");
	return Z(e, `Vertical(${t.substanceId})`);
}
function ln(e) {
	let t = Y(e), n = X(t)[0], r = tn(t, "circle");
	if (!n || !r) throw Error("선분 하나와 원 하나를 선택하세요.");
	return Z(e, `Tangent(${n.substanceId}, ${r.substanceId})`);
}
async function un(e) {
	let t = Y(e).filter((e) => e.kind === "point");
	if (t.length !== 2) throw Error("점 두 개를 선택하세요.");
	let n = K(e), r = q(v(n.scope)), i = await mn(e, "Distance 값", pn(r, dn(n.scope, r), t[0].substanceId, t[1].substanceId), [
		30,
		60,
		90,
		120,
		180,
		240
	]);
	return i === null ? null : Z(e, `Distance(${t[0].substanceId}, ${t[1].substanceId}, ${Sn(i)})`);
}
function dn(e, t) {
	return I(t, {
		seeds: e.convergedSeeds,
		memberPins: fn(),
		config: e.solverConfig,
		iterations: 0
	});
}
function fn() {
	return {
		pinnedDofs: /* @__PURE__ */ new Map(),
		slackWeight: /* @__PURE__ */ new Map()
	};
}
function pn(e, t, n, r) {
	let i = e.instances.get(n), a = e.instances.get(r);
	if (!i || !a) return 100;
	let o = e.dofs.find((e) => e.instanceId === n), s = e.dofs.find((e) => e.instanceId === r);
	return !o || !s ? 100 : Math.round(Math.hypot(t.values[o.offset] - t.values[s.offset], t.values[o.offset + 1] - t.values[s.offset + 1]) * 10) / 10;
}
async function mn(e, t, n, r) {
	let i = e.getExtensionApi?.("sys.minibuffer");
	if (i?.completingRead) {
		let e = [.../* @__PURE__ */ new Set([Sn(n), ...r])];
		return i.completingRead({
			prompt: t,
			candidates: e.map((e) => ({
				id: String(e),
				label: `${e}`,
				value: e
			}))
		});
	}
	return Sn(n);
}
function hn(e) {
	let t = K(e);
	if (!t) throw Error("Kite 스코프를 선택하세요.");
	let n = v(t.scope), r = q(n), i = et(t.scopeId, e.world.getCanonicalView()), a = Yt(r, "P"), o = Math.round((i?.width ?? 520) / 2), s = Math.round((i?.height ?? 360) / 2);
	return J(e, {
		entityId: t.scopeId,
		substanceDsl: Xt(n, `Point ${a} = (${o}, ${s})`)
	});
}
function gn(e) {
	let t = K(e);
	if (!t) throw Error("Kite 스코프를 선택하세요.");
	let n = v(t.scope);
	return J(e, {
		entityId: t.scopeId,
		substanceDsl: Zt(n.substanceDsl)
	});
}
function _n(e) {
	let t = K(e);
	if (!t) throw Error("Kite 스코프를 선택하세요.");
	let n = v(t.scope), i = q(n), a = Ee(i, e.world.getCanonicalView()), o = I(i, {
		seeds: n.convergedSeeds,
		memberPins: a,
		config: n.solverConfig,
		iterations: 240
	}), s = L(i, o.values);
	return Ut(e, () => {
		e.world.applyCanonicalTransaction(l.reproject, [{
			id: t.scopeId,
			aspect: r,
			patch: { convergedSeeds: s }
		}], "local:user");
	}), {
		residual: o.residual,
		converged: o.converged
	};
}
function vn(e) {
	let t = K(e);
	if (!t) throw Error("Kite 스코프를 선택하세요.");
	let n = v(t.scope), a = {}, o = [];
	for (let n of e.world.listEntityIds()) {
		let r = e.world.getCanonical(n, i);
		r?.scopeId === t.scopeId && r.substanceId && (a[r.substanceId] ? o.push(n) : a[r.substanceId] = n);
	}
	let s = {
		...n,
		entityBindings: a
	}, c = q(s), u = Ee(c, e.world.getCanonicalView()), d = L(c, I(c, {
		seeds: s.convergedSeeds,
		memberPins: u,
		config: s.solverConfig,
		iterations: 180
	}).values);
	return Ut(e, () => {
		e.world.applyCanonicalTransaction(l.repair, [...o.map((e) => ({
			id: e,
			aspect: i,
			patch: null
		})), {
			id: t.scopeId,
			aspect: r,
			patch: {
				entityBindings: a,
				convergedSeeds: d
			}
		}], "local:user");
	}), {
		bindings: Object.keys(a).length,
		removed: o.length
	};
}
function yn(e) {
	let t = en(e), n = t.filter((e) => e.kind === "point"), r = X(t)[0], i = tn(t, "circle"), a = X(t), o = [];
	return n.length === 1 && i && o.push({
		id: "on-circle",
		label: "원 위에 배치 OnCircle",
		run: () => nn(e)
	}), a.length === 2 && (o.push({
		id: "perpendicular",
		label: "직교 ⊥ Perpendicular",
		run: () => an(e)
	}), o.push({
		id: "equal-length",
		label: "등길이 = EqualLength",
		run: () => on(e)
	})), (n.length === 3 || n.length === 1 && r) && o.push({
		id: "midpoint",
		label: "중점 Midpoint",
		run: () => rn(e)
	}), n.length === 2 && o.push({
		id: "distance",
		label: "거리 Distance",
		run: () => un(e)
	}), r && i && o.push({
		id: "tangent",
		label: "접선 Tangent",
		run: () => ln(e)
	}), r && (o.push({
		id: "horizontal",
		label: "수평 Horizontal",
		run: () => sn(e)
	}), o.push({
		id: "vertical",
		label: "수직 Vertical",
		run: () => cn(e)
	})), o;
}
async function bn(e) {
	let t = yn(e);
	if (!t.length) throw Error("선택한 멤버 조합에 사용할 수 있는 구속이 없습니다. 점·선분·원을 함께 선택하세요.");
	let n = e.getExtensionApi?.("sys.minibuffer");
	if (n?.completingRead) {
		let e = await n.completingRead({
			prompt: "Kite 구속 선택",
			candidates: t.map((e) => ({
				id: e.id,
				label: e.label,
				value: e
			}))
		});
		return e ? e.run() : null;
	}
	return t[0].run();
}
function xn(e) {
	let t = (e) => () => e();
	return [
		{
			id: l.insert,
			title: "Kite 다이어그램 추가",
			summary: "Domain · Substance · Style 예제와 멤버 엔티티를 한 번에 만듭니다.",
			shortcutScope: "canvas",
			run: t(() => qt(e))
		},
		{
			id: l.apply,
			title: "Kite DSL 적용",
			summary: "선택한 Kite 스코프의 세 DSL을 한 번의 Undo로 적용하고 다시 수렴합니다.",
			shortcutScope: "canvas",
			run: (t) => J(e, t && typeof t == "object" && !Array.isArray(t) ? t : {})
		},
		{
			id: l.reset,
			title: "Kite 기본 예제로 복원",
			summary: "선택한 Kite 스코프를 기본 예제로 되돌립니다.",
			shortcutScope: "canvas",
			run: t(() => Jt(e))
		},
		{
			id: l.addPoint,
			title: "Kite 점 추가",
			summary: "선택한 스코프에 자유 점을 추가합니다.",
			shortcutScope: "canvas",
			run: t(() => hn(e))
		},
		{
			id: l.addConstraint,
			title: "Kite 구속 추가",
			summary: "선택한 멤버 조합에 가능한 기하 구속을 제시합니다.",
			shortcutScope: "canvas",
			run: () => bn(e)
		},
		{
			id: l.onCircle,
			title: "Kite: 원 위에 배치",
			summary: "선택한 점과 원에 OnCircle 구속을 추가합니다.",
			shortcutScope: "canvas",
			run: t(() => nn(e))
		},
		{
			id: l.midpoint,
			title: "Kite: 중점",
			summary: "선택한 점을 두 점의 중점으로 구속합니다.",
			shortcutScope: "canvas",
			run: t(() => rn(e))
		},
		{
			id: l.perpendicular,
			title: "Kite: 직교",
			summary: "선택한 두 선분을 직교로 구속합니다.",
			shortcutScope: "canvas",
			run: t(() => an(e))
		},
		{
			id: l.equalLength,
			title: "Kite: 등길이",
			summary: "선택한 두 선분의 길이를 같게 구속합니다.",
			shortcutScope: "canvas",
			run: t(() => on(e))
		},
		{
			id: l.horizontal,
			title: "Kite: 수평",
			summary: "선택한 선분을 수평으로 구속합니다.",
			shortcutScope: "canvas",
			run: t(() => sn(e))
		},
		{
			id: l.vertical,
			title: "Kite: 수직",
			summary: "선택한 선분을 수직으로 구속합니다.",
			shortcutScope: "canvas",
			run: t(() => cn(e))
		},
		{
			id: l.tangent,
			title: "Kite: 접선",
			summary: "선택한 선분과 원을 접하도록 구속합니다.",
			shortcutScope: "canvas",
			run: t(() => ln(e))
		},
		{
			id: l.distance,
			title: "Kite: 거리 지정",
			summary: "선택한 두 점 사이 거리를 지정합니다.",
			shortcutScope: "canvas",
			run: () => un(e)
		},
		{
			id: l.freeze,
			title: "Kite: 기하 고정",
			summary: "모든 구속을 제거하고 현재 좌표를 핀으로 고정합니다.",
			shortcutScope: "canvas",
			run: t(() => gn(e))
		},
		{
			id: l.repair,
			title: "Kite: 바인딩 복구",
			summary: "스코프의 substanceId ↔ 엔티티 바인딩을 실제 멤버에서 다시 만듭니다.",
			shortcutScope: "canvas",
			run: t(() => vn(e))
		},
		{
			id: l.reproject,
			title: "Kite: 다시 수렴",
			summary: "현재 정본에서 솔버를 다시 돌려 시드를 갱신합니다.",
			shortcutScope: "canvas",
			run: t(() => _n(e))
		}
	];
}
function Sn(e) {
	return Math.round(e * 100) / 100;
}
// src/tools/drag-session.ts
var Cn = class {
	scope;
	compiled;
	pins;
	substanceId;
	kind;
	seeds;
	state;
	promotion = null;
	constructor(e, t, n, r, i) {
		this.scope = e, this.compiled = t, this.pins = n, this.substanceId = r, this.kind = i;
		let a = I(t, {
			seeds: e.convergedSeeds,
			memberPins: n,
			config: e.solverConfig,
			iterations: 0
		});
		this.state = a, this.seeds = L(t, a.values);
	}
	currentState() {
		return this.state;
	}
	currentSeeds() {
		return this.seeds;
	}
	currentPromotion() {
		return this.promotion;
	}
	moveTo(e, t, n, r) {
		let i = Math.max(1, Math.min(24, this.scope.solverConfig.maxSubstepsPerFrame)), a = this.kind === "point" ? {
			substanceId: this.substanceId,
			kind: "point",
			value: 0,
			x: e,
			y: t,
			strength: .38
		} : {
			substanceId: this.substanceId,
			kind: "radius",
			value: wn(this.compiled, this.state, this.substanceId, e, t),
			strength: .4
		}, o = Ye(this.scope, this.compiled, this.pins, this.seeds, i, a);
		return this.promotion = n ? Tn(this.scope, this.compiled, this.pins, this.substanceId, this.kind, e, t, r, o) : null, this.state = this.promotion ? Ye(this.scope, this.compiled, this.pins, L(this.compiled, o.values, this.seeds), i, a, [this.promotion.constraint]) : o, this.seeds = L(this.compiled, this.state.values, this.seeds), {
			seeds: this.seeds,
			state: this.state,
			promotion: this.promotion
		};
	}
	finish() {
		let e = this.promotion ? [this.promotion.constraint] : [];
		this.state = Ye(this.scope, this.compiled, this.pins, this.seeds, 90, void 0, e), this.seeds = L(this.compiled, this.state.values);
		let t = this.promotion && !En(this.compiled, this.promotion.constraint) ? `${this.scope.substanceDsl.replace(/\s*$/, "")}\n${this.promotion.line}\n` : this.scope.substanceDsl;
		return {
			seeds: this.seeds,
			state: this.state,
			promotion: this.promotion,
			substanceDsl: t
		};
	}
};
function wn(e, t, n, r, i) {
	let a = j(e);
	a.values.set(t.values);
	let o = M(a, e.instances.get(n)?.center ?? "");
	return Math.max(1, Math.hypot(r - o.x, i - o.y));
}
function Tn(e, t, n, r, i, a, o, s, c) {
	if (i !== "point" || !e.solverConfig.autoPromoteSnap) return null;
	let l = j(t, n);
	l.values.set(c.values);
	let u = M(l, r), d = [];
	for (let e of t.instances.values()) {
		if (![
			"segment",
			"line",
			"ray"
		].includes(e.kind) || e.a !== r && e.b !== r) continue;
		let n = e.a === r ? e.b : e.a, i = M(l, n), a = {
			x: u.x - i.x,
			y: u.y - i.y
		};
		for (let o of t.instances.values()) {
			if (o.id === e.id || ![
				"segment",
				"line",
				"ray"
			].includes(o.kind) || o.a !== r && o.b !== r) continue;
			let s = o.a === r ? o.b : o.a;
			if (s !== n) continue;
			let c = M(l, s), u = {
				x: c.x - i.x,
				y: c.y - i.y
			}, f = Math.hypot(a.x, a.y), p = Math.hypot(u.x, u.y);
			if (f < 1e-6 || p < 1e-6) continue;
			let m = Math.abs(Math.acos(Math.max(-1, Math.min(1, (a.x * u.x + a.y * u.y) / (f * p))))), h = Math.abs(m - Math.PI / 2);
			h < 3 * Math.PI / 180 && !En(t, {
				type: "perpendicular",
				a: e.id,
				b: o.id
			}) && d.push({
				score: h * 100,
				promotion: {
					kind: "perpendicular",
					text: `⊥ Perpendicular(${e.id}, ${o.id})`,
					line: `Perpendicular(${e.id}, ${o.id})`,
					constraint: {
						type: "perpendicular",
						a: e.id,
						b: o.id,
						soft: !1,
						weight: 1,
						sourceLine: 0,
						text: `Perpendicular(${e.id}, ${o.id})`
					}
				}
			});
		}
	}
	for (let e of t.instances.values()) {
		if (![
			"segment",
			"line",
			"ray"
		].includes(e.kind) || e.a === r || e.b === r) continue;
		let n = M(l, e.a), i = M(l, e.b), a = Math.hypot(u.x - (n.x + i.x) / 2, u.y - (n.y + i.y) / 2);
		a <= s && !En(t, {
			type: "midpoint",
			point: r,
			a: e.a,
			b: e.b
		}) && d.push({
			score: a,
			promotion: {
				kind: "midpoint",
				text: `⇧ Midpoint(${r}, ${e.a}, ${e.b})`,
				line: `Midpoint(${r}, ${e.a}, ${e.b})`,
				constraint: {
					type: "midpoint",
					point: r,
					a: e.a,
					b: e.b,
					soft: !1,
					weight: 1,
					sourceLine: 0,
					text: `Midpoint(${r}, ${e.a}, ${e.b})`
				}
			}
		});
	}
	for (let e of t.instances.values()) {
		if (e.kind !== "circle") continue;
		let n = M(l, e.center ?? ""), i = N(l, e.id), a = Math.abs(Math.hypot(u.x - n.x, u.y - n.y) - i);
		a <= s && !En(t, {
			type: "onCircle",
			point: r,
			circle: e.id
		}) && d.push({
			score: a,
			promotion: {
				kind: "onCircle",
				text: `○ OnCircle(${r}, ${e.id})`,
				line: `OnCircle(${r}, ${e.id})`,
				constraint: {
					type: "onCircle",
					point: r,
					circle: e.id,
					soft: !1,
					weight: 1,
					sourceLine: 0,
					text: `OnCircle(${r}, ${e.id})`
				}
			}
		});
	}
	return d.sort((e, t) => e.score - t.score), d[0]?.promotion ?? null;
}
function En(e, t) {
	for (let n of e.constraints) if (n.type === t.type) {
		if (t.type === "midpoint" && n.type === "midpoint") {
			if (n.point === t.point && n.a === t.a && n.b === t.b) return !0;
		} else if (t.type === "perpendicular" && n.type === "perpendicular") {
			if (n.a === t.a && n.b === t.b || n.a === t.b && n.b === t.a) return !0;
		} else if (t.type === "onCircle" && n.type === "onCircle" && n.point === t.point && n.circle === t.circle) return !0;
	}
	return !1;
}
// src/tools/kite-manipulate.ts
var Dn = "root.select.core.select-suite:idle", On = 45, kn = 8, An = 3.5, jn = "#6A6CD9", Mn = class {
	context;
	owner = `${t}:manipulate:${Math.random().toString(36).slice(2, 8)}`;
	disposers = [];
	gizmoDisposers = [];
	bindAbort;
	stateDisposer;
	scratch;
	surface;
	hudSvg;
	locus;
	badge;
	gesture;
	selectionKey = "";
	composing = !1;
	compositionEnded = -Infinity;
	disposed = !1;
	constructor(e) {
		this.context = e;
		let t = e.services.get("canvas.active-tool-surface");
		t ? (this.bind(t.get()), this.disposers.push(t.subscribe(() => this.bind(t.get())))) : this.bind(Pn(e));
		let n = e.services.get("canvas.frames");
		this.disposers.push(n ? n.subscribe(() => this.tick()) : In(this.tick, 16));
	}
	dispose() {
		if (!this.disposed) {
			this.disposed = !0, this.cancel();
			for (let e of this.disposers.splice(0).reverse()) e();
			this.releaseSurface();
		}
	}
	bind(e) {
		if (this.disposed || e === this.surface || (this.releaseSurface(), this.surface = e, !e)) return;
		this.scratch = this.context.world.createScratchOverlay(this.owner);
		let n = e.surface.element.ownerDocument;
		this.bindAbort = new ((e.surface.element.ownerDocument.defaultView?.AbortController) ?? AbortController)();
		let r = this.bindAbort.signal;
		e.surface.element.addEventListener("pointerdown", this.onPointerDown, {
			capture: !0,
			signal: r
		}), e.surface.element.addEventListener("pointermove", this.onPointerMove, {
			capture: !0,
			signal: r
		}), e.surface.element.addEventListener("pointerup", this.onPointerUp, {
			capture: !0,
			signal: r
		}), e.surface.element.addEventListener("pointercancel", this.onPointerCancel, {
			capture: !0,
			signal: r
		}), e.surface.element.addEventListener("lostpointercapture", this.onPointerCancel, {
			capture: !0,
			signal: r
		}), n.addEventListener("keydown", this.onKeyDown, {
			capture: !0,
			signal: r
		}), n.addEventListener("compositionstart", this.onCompositionStart, { signal: r }), n.addEventListener("compositionend", this.onCompositionEnd, { signal: r }), n.defaultView?.addEventListener("blur", this.cancel, { signal: r }), this.stateDisposer = e.selection.stateMachine.mountChildState("root.select", {
			id: `${t}:manipulate`,
			onExit: () => this.cancel()
		}), this.buildHud(e), this.rebuildGizmos();
	}
	releaseSurface() {
		this.bindAbort?.abort(), this.bindAbort = void 0, this.stateDisposer?.(), this.stateDisposer = void 0;
		for (let e of this.gizmoDisposers.splice(0)) e();
		this.scratch?.dispose(), this.scratch = void 0, this.hudSvg?.remove(), this.hudSvg = void 0, this.locus = void 0, this.badge?.remove(), this.badge = void 0, this.surface = void 0, this.gesture = void 0;
	}
	buildHud(e) {
		let t = e.surface.element.ownerDocument, n = t.createElementNS("http://www.w3.org/2000/svg", "svg");
		n.dataset.role = "kite-locus", n.setAttribute("aria-hidden", "true"), n.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:4;";
		let r = t.createElementNS("http://www.w3.org/2000/svg", "polyline");
		r.setAttribute("fill", "none"), r.setAttribute("stroke", jn), r.setAttribute("stroke-width", "1.5"), r.setAttribute("stroke-dasharray", "5 5"), r.setAttribute("stroke-opacity", "0.85"), n.append(r), e.surface.hud.append(n), this.hudSvg = n, this.locus = r;
		let i = t.createElement("div");
		i.dataset.role = "kite-snap-badge", i.style.cssText = "position:absolute;pointer-events:none;padding:4px 8px;border-radius:6px;background:rgba(17,24,39,0.92);color:#f8fafc;font:600 11px/1.35 system-ui,-apple-system,sans-serif;white-space:nowrap;display:none;z-index:5;box-shadow:0 4px 14px rgba(0,0,0,0.25);", e.surface.hud.append(i), this.badge = i;
	}
	editableTarget() {
		if (!this.surface) return;
		let e = this.surface.selection.getSelection();
		for (let t of e) {
			let e = this.context.world.getCanonical(t, r);
			if (e) {
				let n = R(e);
				return {
					scopeId: t,
					substanceIds: new Set([...n.instances.values()].filter((e) => e.kind === "point").map((e) => e.id)),
					circles: new Set([...n.instances.values()].filter((e) => e.kind === "circle").map((e) => e.id))
				};
			}
		}
		let t = /* @__PURE__ */ new Set(), n = /* @__PURE__ */ new Set(), a;
		for (let o of e) {
			let e = this.context.world.getCanonical(o, i);
			if (!e?.scopeId || !e.substanceId) continue;
			let s = this.context.world.getCanonical(e.scopeId, r);
			if (!s) continue;
			a = e.scopeId;
			let c = R(s).instances.get(e.substanceId);
			if (c) {
				for (let e of [
					"a",
					"b",
					"center"
				]) c[e] && t.add(c[e]);
				for (let e of c.points ?? []) t.add(e);
				for (let e of c.angle ?? []) t.add(e);
				c.label?.anchor.id && t.add(c.label.anchor.id), c.kind === "point" && t.add(c.id), c.kind === "circle" && n.add(c.id), c.kind === "arc" && t.add(c.center ?? "");
			}
		}
		return a ? {
			scopeId: a,
			substanceIds: t,
			circles: n
		} : void 0;
	}
	rebuildGizmos() {
		for (let e of this.gizmoDisposers.splice(0)) e();
		let e = this.surface, t = this.editableTarget();
		if (!e || !t) return;
		let n = this.context.world.getCanonical(t.scopeId, r);
		if (!n) return;
		let i = R(n);
		for (let n of t.substanceIds) {
			if (!i.instances.has(n)) continue;
			let r = `${this.owner}|p|${t.scopeId}|${n}`;
			this.gizmoDisposers.push(e.selection.gizmos.register({
				id: r,
				priority: On,
				shape: "circle",
				radiusScreenPx: kn,
				getWorldPosition: (e) => this.handleWorld(t.scopeId, n, void 0, e),
				onPointerDown: (e) => this.begin(t.scopeId, n, "point", e)
			}));
		}
		for (let n of t.circles) {
			if (!i.instances.has(n)) continue;
			let r = `${this.owner}|r|${t.scopeId}|${n}`;
			this.gizmoDisposers.push(e.selection.gizmos.register({
				id: r,
				priority: On,
				shape: "circle",
				radiusScreenPx: kn,
				getWorldPosition: (e) => this.handleWorld(t.scopeId, n, "radius", e),
				onPointerDown: (e) => this.begin(t.scopeId, n, "radius", e)
			}));
		}
	}
	handleWorld(e, t, n, i) {
		let a = this.context.world.getCanonical(e, r), o = et(e, this.context.world.getCanonicalView());
		if (!a || !o || this.context.world.isEntityReadOnly(e)) return !1;
		let s = R(a), c = Je(a, this.context.world.getCanonicalView()), l = j(s, c.pins);
		if (l.values.set(c.state.values), n === "radius") {
			let e = M(l, s.instances.get(t)?.center ?? ""), n = z(o, e.x + N(l, t), e.y);
			i.x = n.x, i.y = n.y;
		} else {
			let e = M(l, t), n = z(o, e.x, e.y);
			i.x = n.x, i.y = n.y;
		}
		return !0;
	}
	onPointerDown = (e) => {
		if (this.gesture || e.button !== 0 || e.defaultPrevented || this.imeLocked() || this.surface?.host.isPanGesture?.(e) || this.surface?.host.isSelectionEnabled?.() === !1 || Fn(e)) return;
		let t = {
			id: "",
			priority: 0,
			distanceScreenPx: 0
		};
		if (this.surface?.selection.gizmos.hitTest(e.clientX, e.clientY, this.surface.host.worldToScreen, t)) {
			let [, n, r, i] = t.id.split("|");
			if (t.id.startsWith(`${this.owner}|`) && r && i) {
				let t = n === "r" ? "radius" : "point";
				if (this.begin(r, i, t, e)) return;
			}
		}
		let n = this.editableTarget();
		if (!n) return;
		let i = this.context.world.getCanonical(n.scopeId, r), a = et(n.scopeId, this.context.world.getCanonicalView());
		if (!i || !a) return;
		let o = {
			x: 0,
			y: 0
		};
		this.surface.host.screenToWorld(e.clientX, e.clientY, o);
		let s = tt(a, o.x, o.y), c = R(i), l = Je(i, this.context.world.getCanonicalView()), u = j(c, l.pins);
		u.values.set(l.state.values);
		let d = kn / Math.max(.001, this.surface.host.getZoom()), f;
		for (let e of n.substanceIds) {
			let t = M(u, e), n = Math.hypot(t.x - s.x, t.y - s.y);
			n <= d && (!f || n < f.distance) && (f = {
				id: e,
				distance: n
			});
		}
		f && this.begin(n.scopeId, f.id, "point", e);
	};
	begin(e, n, i, a) {
		if (!this.surface || this.gesture) return !1;
		let o = this.context.world.getCanonical(e, r), s = et(e, this.context.world.getCanonicalView());
		if (!o || !s || this.context.world.isEntityReadOnly(e)) return !1;
		let c = R(o);
		if (!c.ok) return this.report(Error(c.errors[0]?.message ?? "Kite DSL 오류")), !1;
		let l = Ee(c, this.context.world.getCanonicalView()), u = {
			...o,
			solverConfig: { ...o.solverConfig }
		}, d = new Cn(u, c, l, n, i);
		return this.gesture = {
			pointer: a.pointerId,
			clientX: a.clientX,
			clientY: a.clientY,
			startX: a.clientX,
			startY: a.clientY,
			shift: a.shiftKey,
			moved: !1,
			scopeId: e,
			scope: u,
			compiled: c,
			pins: l,
			box: s,
			instanceId: n,
			kind: i,
			session: d
		}, this.surface.selection.stateMachine.transition(`root.select.${t}:manipulate`), this.surface.surface.element.setPointerCapture?.(a.pointerId), this.updateBadge(), a.preventDefault(), a.stopImmediatePropagation(), !0;
	}
	onPointerMove = (e) => {
		let t = this.gesture;
		t && t.pointer === e.pointerId && (t.clientX = e.clientX, t.clientY = e.clientY, t.shift = e.shiftKey, t.moved ||= Math.hypot(e.clientX - t.startX, e.clientY - t.startY) >= An, this.updateBadge(), e.preventDefault(), e.stopImmediatePropagation());
	};
	onPointerUp = (e) => {
		let t = this.gesture;
		if (!t || t.pointer !== e.pointerId) return;
		t.clientX = e.clientX, t.clientY = e.clientY, t.moved ||= Math.hypot(e.clientX - t.startX, e.clientY - t.startY) >= An, t.moved && this.applyGesture();
		let n = t.session.finish(), r = n.substanceDsl !== t.scope.substanceDsl;
		if (this.finishGesture(), t.moved && (r || JSON.stringify(n.seeds) !== JSON.stringify(t.scope.convergedSeeds))) {
			let e = { convergedSeeds: n.seeds };
			r && (e.substanceDsl = n.substanceDsl);
			try {
				$t(this.context, t.scopeId, e, "manipulate");
			} catch (e) {
				this.report(e instanceof Error ? e : Error(String(e)));
			}
		}
		this.surface?.host.requestRender(), e.preventDefault(), e.stopImmediatePropagation();
	};
	onPointerCancel = (e) => {
		this.gesture && this.gesture.pointer !== e.pointerId || this.cancel();
	};
	onKeyDown = (e) => {
		e.key === "Escape" && this.gesture && !this.imeLocked(e) && (this.cancel(), e.preventDefault(), e.stopImmediatePropagation());
	};
	onCompositionStart = () => {
		this.composing = !0;
	};
	onCompositionEnd = () => {
		this.composing = !1, this.compositionEnded = performance.now();
	};
	cancel = () => {
		this.gesture && (this.finishGesture(), this.surface?.host.requestRender());
	};
	finishGesture() {
		let e = this.gesture;
		if (this.gesture = void 0, this.scratch?.clear(), this.locus?.setAttribute("points", ""), this.badge && (this.badge.style.display = "none"), this.surface) {
			try {
				this.surface.selection.stateMachine.transition(Dn);
			} catch {}
			if (e) try {
				this.surface.surface.element.releasePointerCapture?.(e.pointer);
			} catch {}
		}
	}
	tick() {
		if (this.disposed || !this.surface) return;
		let e = this.surface.selection.getSelection().join(",");
		e !== this.selectionKey && (this.selectionKey = e, this.rebuildGizmos()), this.gesture?.moved && this.applyGesture();
	}
	applyGesture() {
		let e = this.gesture;
		if (!e || !this.surface) return;
		let t = {
			x: 0,
			y: 0
		};
		this.surface.host.screenToWorld(e.clientX, e.clientY, t);
		let n = tt(e.box, t.x, t.y), i = 14 / Math.max(.001, this.surface.host.getZoom()), a = e.session.moveTo(n.x, n.y, e.shift, i);
		this.scratch?.set(e.scopeId, r, { convergedSeeds: a.seeds }), this.updateLocus(), this.updateBadge(), this.surface.host.requestRender();
	}
	updateBadge() {
		let e = this.gesture;
		if (!this.badge || !this.surface) return;
		if (!e || !e.moved) {
			this.badge.style.display = "none";
			return;
		}
		let t = e.session.currentPromotion();
		this.badge.textContent = t ? t.text : `Kite · ${e.instanceId}`, this.badge.style.display = "block";
		let n = this.surface.surface.hud.getBoundingClientRect(), r = this.surface.surface.element.getBoundingClientRect();
		this.badge.style.left = `${e.clientX - (n.width ? n.left : r.left) + 14}px`, this.badge.style.top = `${e.clientY - (n.width ? n.top : r.top) - 30}px`, this.badge.style.color = t ? "#fef3c7" : "#f8fafc";
	}
	updateLocus() {
		let e = this.gesture;
		if (!e || !this.locus || !this.surface) return;
		let t = Nn(e, this.surface);
		this.locus.setAttribute("points", t);
	}
	imeLocked(e) {
		return this.composing || !(!e || !e.isComposing && e.keyCode !== 229 && e.key !== "Process") || performance.now() - this.compositionEnded < 16;
	}
	report(e) {
		this.surface?.host.onError?.(e);
	}
};
function Nn(e, t) {
	let n = j(e.compiled, e.pins);
	n.values.set(e.session.currentState().values);
	let r = [], i = {
		x: 0,
		y: 0
	}, a = t.surface.hud.getBoundingClientRect(), o = t.surface.element.getBoundingClientRect(), s = a.width ? a.left : o.left, c = a.width ? a.top : o.top, l = (n) => {
		let a = z(e.box, n.x, n.y);
		t.host.worldToScreen(a.x, a.y, i), r.push({
			x: i.x - s,
			y: i.y - c
		});
	};
	for (let t of e.compiled.constraints) {
		if (t.type === "onCircle" && t.point === e.instanceId) {
			let r = M(n, e.compiled.instances.get(t.circle)?.center ?? ""), i = N(n, t.circle);
			for (let e = 0; e <= 72; e++) {
				let t = e / 72 * Math.PI * 2;
				l({
					x: r.x + Math.cos(t) * i,
					y: r.y + Math.sin(t) * i
				});
			}
			break;
		}
		if (t.type === "distance" && (t.a === e.instanceId || t.b === e.instanceId)) {
			let r = M(n, t.a === e.instanceId ? t.b : t.a);
			for (let e = 0; e <= 72; e++) {
				let n = e / 72 * Math.PI * 2;
				l({
					x: r.x + Math.cos(n) * t.value,
					y: r.y + Math.sin(n) * t.value
				});
			}
			break;
		}
		if ((t.type === "horizontal" || t.type === "vertical") && !r.length) {
			let r = e.compiled.instances.get(t.segment);
			if (!r || r.a !== e.instanceId && r.b !== e.instanceId) continue;
			let i = M(n, e.instanceId);
			t.type === "horizontal" ? (l({
				x: 0,
				y: i.y
			}), l({
				x: e.box.width,
				y: i.y
			})) : (l({
				x: i.x,
				y: 0
			}), l({
				x: i.x,
				y: e.box.height
			}));
			break;
		}
	}
	return r.map((e) => `${Math.round(e.x * 10) / 10},${Math.round(e.y * 10) / 10}`).join(" ");
}
function Pn(e) {
	let t = e.services.get("canvas.surface"), n = e.services.get("canvas.interaction"), r = e.services.get("canvas.selection");
	if (t?.element && t.hud) return {
		surface: {
			element: t.element,
			hud: t.hud
		},
		selection: {
			stateMachine: {
				stateId: "root",
				mountChildState: () => () => {},
				transition: () => {}
			},
			gizmos: {
				register: () => () => {},
				hitTest: () => !1
			},
			getSelection: () => [...r?.getSelection?.() ?? []],
			select: (e) => r?.select?.(e)
		},
		host: {
			screenToWorld: (e, t, r) => n?.screenToWorld?.(e, t, r),
			worldToScreen: (e, t, r) => n?.worldToScreen?.(e, t, r),
			getZoom: () => n?.getZoom?.() ?? 1,
			requestRender: () => n?.requestRender?.(),
			history: n?.history ?? {
				begin() {},
				commit() {},
				abort() {}
			},
			onError: (e) => console.error("[kite]", e)
		}
	};
}
function Fn(e) {
	let t = (e) => e instanceof Element && !!e.closest("[data-canvas-ui],button,input,textarea,select,[contenteditable]:not([contenteditable=\"false\"])");
	return t(e.target) || e.composedPath().some(t);
}
function In(e, t) {
	let n = setInterval(e, t);
	return () => clearInterval(n);
}
// src/panel/tri-editor.ts
var Ln = [
	{
		id: "domain",
		field: "domainDsl",
		label: "Domain"
	},
	{
		id: "substance",
		field: "substanceDsl",
		label: "Substance"
	},
	{
		id: "style",
		field: "styleDsl",
		label: "Style"
	}
];
function Rn() {
	return {
		panelId: o.triEditor,
		title: "Kite Tri-DSL",
		icon: { paths: [
			"M4 5h12",
			"M4 10h8",
			"M4 15h12",
			"M17 8l3 3-3 3"
		] },
		defaultZone: "right",
		inspectorFor: r,
		isolation: "container",
		mount(e, t) {
			return zn(e, t);
		}
	};
}
function zn(e, t) {
	let n = e.ownerDocument, i = new ((n.defaultView?.AbortController) ?? AbortController)(), a = i.signal;
	e.replaceChildren(), e.style.cssText = "display:flex;flex-direction:column;gap:0;height:100%;min-height:0;background:var(--alid-bg-surface,#fff);color:var(--alid-text-primary,#18181b);";
	let o = () => {
		for (let e of t.getSelectedIds()) {
			if (t.world.getCanonical(e, "kite.scope")) return e;
			let n = t.world.getCanonical(e, "kite.member");
			if (n?.scopeId) return n.scopeId;
		}
	}, s = o(), c = s ? v(t.world.getCanonical(s, r)) : void 0, u = "substance", d = !1, f = Q(n, "div", "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--alid-border-subtle,#e4e4e7);"), p = Q(n, "div", "font:600 12px/1.3 system-ui,sans-serif;letter-spacing:0.01em;", "Kite Tri-DSL"), m = Q(n, "div", "font:500 10.5px/1.3 system-ui,sans-serif;color:var(--alid-text-muted,#71717a);white-space:nowrap;", "스코프 선택 없음");
	f.append(p, m);
	let h = Q(n, "div", "display:flex;gap:2px;padding:8px 10px 0;border-bottom:1px solid var(--alid-border-subtle,#e4e4e7);"), g = /* @__PURE__ */ new Map();
	for (let e of Ln) {
		let t = Q(n, "button", "appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;padding:6px 9px 7px;font:600 11.5px/1.2 system-ui,sans-serif;color:var(--alid-text-muted,#71717a);cursor:pointer;border-radius:6px 6px 0 0;", e.label);
		t.type = "button", t.dataset.tab = e.id, t.addEventListener("click", () => {
			d && D(), u = e.id, ie();
		}, { signal: a }), g.set(e.id, t), h.append(t);
	}
	let _ = Q(n, "div", "display:flex;flex:1;min-height:0;position:relative;"), y = Q(n, "pre", "margin:0;padding:10px 8px;width:38px;box-sizing:border-box;text-align:right;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--alid-text-muted,#a1a1aa);background:var(--alid-bg-muted,#fafafa);border-right:1px solid var(--alid-border-subtle,#e4e4e7);overflow:hidden;user-select:none;"), b = n.createElement("textarea");
	b.setAttribute("aria-label", "Kite DSL 소스"), b.spellcheck = !1, b.style.cssText = "flex:1;min-width:0;min-height:160px;resize:none;border:0;outline:none;padding:10px;font:11.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--alid-bg-surface,#fff);color:var(--alid-text-primary,#18181b);tab-size:2;white-space:pre;overflow:auto;", _.append(y, b);
	let x = Q(n, "div", "display:none;padding:8px 12px;border-top:1px solid var(--alid-border-subtle,#e4e4e7);background:var(--alid-bg-muted,#fafafa);"), ee = Q(n, "div", "font:600 10px/1.3 system-ui,sans-serif;color:var(--alid-text-muted,#71717a);margin-bottom:4px;", "연관 구문"), S = Q(n, "div", "display:flex;flex-direction:column;gap:3px;max-height:92px;overflow:auto;");
	x.append(ee, S);
	let C = Q(n, "div", "display:none;padding:8px 12px;border-top:1px solid var(--alid-border-subtle,#e4e4e7);max-height:130px;overflow:auto;");
	C.dataset.role = "kite-style-params";
	let te = Q(n, "div", "display:flex;align-items:center;gap:6px;padding:9px 12px;border-top:1px solid var(--alid-border-subtle,#e4e4e7);"), ne = Bn(n, "적용", "background:#2563eb;color:#fff;border:0;"), w = Bn(n, "예제 복원", "background:transparent;color:var(--alid-text-secondary,#52525b);border:1px solid var(--alid-border-subtle,#d4d4d8);"), re = Q(n, "div", "flex:1;"), T = Q(n, "div", "font:500 10.5px/1.3 system-ui,sans-serif;color:var(--alid-text-muted,#71717a);text-align:right;max-width:48%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
	te.append(ne, w, re, T), e.append(f, h, _, x, C, te);
	let E = {
		domain: "",
		substance: "",
		style: ""
	};
	function D() {
		if (!c) return;
		E[u] = b.value;
		let e = Ln.find((e) => e.id === u).field;
		c[e] = b.value, d = !0;
	}
	function O() {
		s = o();
		let e = s ? t.world.getCanonical(s, r) : void 0;
		c = e ? v(e) : void 0, d = !1, c && (E.domain = c.domainDsl, E.substance = c.substanceDsl, E.style = c.styleDsl), ie();
	}
	function ie() {
		if (g.size) for (let [e, t] of g) {
			let n = e === u;
			t.style.color = n ? "var(--alid-accent,#2563eb)" : "var(--alid-text-muted,#71717a)", t.style.borderBottomColor = n ? "var(--alid-accent,#2563eb)" : "transparent", t.style.background = n ? "var(--alid-bg-muted,#fafafa)" : "transparent";
		}
		if (!c || !s) {
			m.textContent = "스코프 선택 없음", T.textContent = "", b.value = "", b.disabled = !0, y.textContent = "", C.style.display = "none", x.style.display = "none";
			return;
		}
		b.disabled = !1, b.value = E[u], y.textContent = Array.from({ length: Math.max(1, b.value.split("\n").length) }, (e, t) => String(t + 1)).join("\n");
		let e = ve({
			...c,
			domainDsl: E.domain,
			substanceDsl: E.substance,
			styleDsl: E.style
		});
		m.textContent = e.ok ? `${e.instances.size}개 개체 · ${e.constraints.length}개 구속${d ? " · 미적용" : ""}` : `오류 ${e.errors.length}개`, m.style.color = e.ok ? "var(--alid-text-muted,#71717a)" : "var(--alid-danger,#dc2626)", T.textContent = e.errors[0] ? `L${e.errors[0].line}: ${e.errors[0].message}` : d ? "Ctrl/⌘+Enter로 적용" : "정본과 동기화됨", T.style.color = e.errors[0] ? "var(--alid-danger,#b91c1c)" : "var(--alid-text-muted,#71717a)", k(e), ae();
	}
	function k(e) {
		if (S.replaceChildren(), !s || !t.getSelectedIds().length) {
			x.style.display = "none";
			return;
		}
		let r = /* @__PURE__ */ new Set();
		for (let e of t.getSelectedIds()) {
			let n = t.world.getCanonical(e, "kite.member");
			n?.scopeId === s && n.substanceId && r.add(n.substanceId);
		}
		if (!r.size) {
			x.style.display = "none";
			return;
		}
		let i = [];
		if (E.substance.split("\n").forEach((e, t) => {
			for (let n of r) if (e.includes(n)) {
				i.push({
					line: t,
					text: e.trim()
				});
				break;
			}
		}), !i.length) x.style.display = "none";
		else {
			x.style.display = "block";
			for (let e of i.slice(0, 8)) {
				let t = n.createElement("button");
				t.type = "button", t.style.cssText = "appearance:none;text-align:left;border:0;background:transparent;padding:2px 4px;border-radius:4px;font:11px/1.4 ui-monospace,monospace;color:var(--alid-text-secondary,#52525b);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;", t.textContent = `L${e.line + 1}  ${e.text}`, t.addEventListener("click", () => {
					u = "substance", ie();
					let t = E.substance.split("\n").slice(0, e.line).join("\n").length + +!!e.line;
					b.focus(), b.setSelectionRange(t, t + e.text.length);
					let n = parseFloat(getComputedStyle(b).lineHeight) || 18;
					b.scrollTop = Math.max(0, e.line * n - 40);
				}, { signal: a }), S.append(t);
			}
		}
	}
	function ae() {
		if (C.replaceChildren(), C.style.display = u === "style" ? "block" : "none", u !== "style") return;
		let e = me(ue(E.style).rules);
		if (!e.length) C.append(Q(n, "div", "font:11px/1.4 system-ui,sans-serif;color:var(--alid-text-muted,#71717a);", "Style DSL에 숫자 파라미터가 없습니다."));
		else for (let t of e.slice(0, 18)) {
			let e = Q(n, "div", "display:grid;grid-template-columns:86px 1fr 48px;align-items:center;gap:8px;margin-bottom:5px;"), r = Q(n, "div", "font:600 10.5px/1.2 system-ui,sans-serif;color:var(--alid-text-secondary,#52525b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", `${t.selector}.${t.key}`), i = n.createElement("input");
			i.type = "range", i.min = String(Math.min(0, t.value * .2)), i.max = String(Math.max(24, t.value * 3)), i.step = "0.5", i.value = String(t.value), i.style.cssText = "width:100%;accent-color:var(--alid-accent,#2563eb);";
			let o = Q(n, "div", "font:11px/1.2 ui-monospace,monospace;text-align:right;color:var(--alid-text-secondary,#52525b);", String(t.value));
			i.addEventListener("input", () => {
				o.textContent = i.value, E.style = Vn(E.style, t.selector, t.key, Number(i.value)), c.styleDsl = E.style, d = !0, b.value = E.style, y.textContent = Array.from({ length: Math.max(1, E.style.split("\n").length) }, (e, t) => String(t + 1)).join("\n"), T.textContent = "Ctrl/⌘+Enter로 적용";
			}, { signal: a }), e.append(r, i, o), C.append(e);
		}
	}
	b.addEventListener("input", () => {
		D();
		let e = b.value.split("\n").length;
		y.textContent = Array.from({ length: Math.max(1, e) }, (e, t) => String(t + 1)).join("\n"), T.textContent = "Ctrl/⌘+Enter로 적용";
	}, { signal: a }), b.addEventListener("scroll", () => {
		y.scrollTop = b.scrollTop;
	}, { signal: a }), b.addEventListener("keydown", (e) => {
		if (!(e.isComposing || e.keyCode === 229)) {
			if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
				e.preventDefault();
				let t = b.selectionStart, n = b.selectionEnd;
				b.setRangeText("  ", t, n, "end"), D();
			} else (e.metaKey || e.ctrlKey) && e.key === "Enter" && (e.preventDefault(), oe());
		}
	}, { signal: a });
	async function oe() {
		if (s && c) {
			d && D();
			try {
				await t.executeCommand(l.apply, {
					entityId: s,
					domainDsl: E.domain,
					substanceDsl: E.substance,
					styleDsl: E.style
				}), d = !1, O();
			} catch (e) {
				T.textContent = e instanceof Error ? e.message.split("\n")[0] : String(e), T.style.color = "var(--alid-danger,#b91c1c)";
			}
		}
	}
	ne.addEventListener("click", () => {
		oe();
	}, { signal: a }), w.addEventListener("click", async () => {
		if (s) try {
			await t.executeCommand(l.reset, { entityId: s }), d = !1, O();
		} catch (e) {
			T.textContent = e instanceof Error ? e.message.split("\n")[0] : String(e), T.style.color = "var(--alid-danger,#b91c1c)";
		}
	}, { signal: a });
	let se = t.onSelectionChange(() => O()), ce = t.onWorldMutated(() => {
		d || O();
	});
	return O(), () => {
		i.abort(), se(), ce(), e.replaceChildren();
	};
}
function Q(e, t, n, r) {
	let i = e.createElement(t);
	return i.style.cssText = n, r !== void 0 && (i.textContent = r), i;
}
function Bn(e, t, n) {
	let r = e.createElement("button");
	return r.type = "button", r.textContent = t, r.style.cssText = `appearance:none;border-radius:6px;padding:5px 10px;font:600 11px/1.25 system-ui,sans-serif;cursor:pointer;${n}`, r;
}
function Vn(e, t, n, r) {
	return e.replace(/([^{}]+)\{([^{}]*)\}/g, (e, i, a) => i.replace(/(^|\n)\s*(#|\/\/).*$/gm, "$1").replace(/\s+/g, " ").split(",").map((e) => e.trim()).includes(t) ? `${i}{${a.replace(RegExp(`(\\b${Hn(n)}\\s*:\\s*)-?(?:\\d+(?:\\.\\d+)?)`, "g"), (e, t) => `${t}${r}`)}}` : e);
}
function Hn(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// src/panel/diagnostics.ts
function Un() {
	return {
		panelId: o.diagnostics,
		title: "Kite 진단",
		icon: { paths: ["M3 17l4-8 4 4 3-6 3 10"] },
		defaultZone: "bottom",
		isolation: "container",
		mount(e, t) {
			return Wn(e, t);
		}
	};
}
function Wn(e, t) {
	let n = e.ownerDocument, i = new ((n.defaultView?.AbortController) ?? AbortController)(), a = i.signal;
	e.replaceChildren(), e.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:9px 12px;height:100%;box-sizing:border-box;overflow:auto;background:var(--alid-bg-surface,#fff);color:var(--alid-text-primary,#18181b);font:11px/1.4 system-ui,sans-serif;";
	let o = $(n, "div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;"), s = $(n, "div", "font:600 12px/1.3 system-ui,sans-serif;", "Kite 진단"), c = $(n, "div", "display:flex;gap:10px;flex-wrap:wrap;color:var(--alid-text-secondary,#52525b);font-variant-numeric:tabular-nums;"), u = $(n, "div", "flex:1;"), d = Gn(n, "다시 수렴", "background:#2563eb;color:#fff;border:0;"), f = Gn(n, "기하 고정", "background:transparent;color:var(--alid-text-secondary,#52525b);border:1px solid var(--alid-border-subtle,#d4d4d8);");
	o.append(s, c, u, d, f);
	let p = $(n, "div", "color:var(--alid-text-muted,#71717a);"), m = $(n, "div", "display:flex;flex-direction:column;gap:3px;"), h = $(n, "div", "padding:10px 0;color:var(--alid-text-muted,#71717a);", "Kite 스코프를 선택하면 자유도와 잔차를 계산합니다.");
	e.append(o, p, m, h);
	let g = () => {
		for (let e of t.getSelectedIds()) {
			if (t.world.getCanonical(e, "kite.scope")) return e;
			let n = t.world.getCanonical(e, "kite.member");
			if (n?.scopeId) return n.scopeId;
		}
	};
	function _() {
		let e = g(), i = e ? t.world.getCanonical(e, r) : void 0;
		if (!i) {
			c.replaceChildren(), p.textContent = "", m.replaceChildren(), h.style.display = "block";
			return;
		}
		h.style.display = "none";
		let a = Je(v(i), t.world.getCanonicalView()), o = Ze(a.compiled, a.state, a.pins);
		if (c.replaceChildren(Kn(n, "DOF", `${o.totalDofs}`), Kn(n, "구속", `${o.constrainedDofs}`), Kn(n, "잔여", `${o.remainingDofs}`), Kn(n, "잔차", qn(o.residual)), Kn(n, "반복", `${o.iterations}`)), p.textContent = [o.converged ? "수렴됨" : o.dirty ? "초기 배치 계산됨 (정본 시드 불일치)" : "수렴 중", ...o.notes].join(" · "), p.style.color = o.converged && !o.notes.length ? "var(--alid-success,#15803d)" : o.remainingDofs === 0 && !o.converged ? "var(--alid-danger,#b91c1c)" : "var(--alid-text-muted,#71717a)", m.replaceChildren(), !o.overConstrained.length) m.append($(n, "div", "color:var(--alid-text-muted,#71717a);", o.constraintCount ? "잔차가 큰 구속이 없습니다." : "구속이 없습니다."));
		else for (let e of o.overConstrained) {
			let t = $(n, "div", "display:grid;grid-template-columns:52px 1fr 74px;gap:8px;align-items:center;padding:3px 6px;border-radius:5px;background:color-mix(in srgb, var(--alid-danger,#dc2626) 6%, transparent);");
			t.append($(n, "span", "color:var(--alid-danger,#b91c1c);font:600 10px/1.2 ui-monospace,monospace;", `L${e.line}`), $(n, "span", "font:11px/1.35 ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", e.text), $(n, "span", "text-align:right;font:10.5px/1.2 ui-monospace,monospace;color:var(--alid-danger,#b91c1c);", qn(e.residual))), m.append(t);
		}
	}
	d.addEventListener("click", () => {
		let e = g();
		e && t.executeCommand(l.reproject, { entityId: e }).then(_).catch(y);
	}, { signal: a }), f.addEventListener("click", () => {
		let e = g();
		e && t.executeCommand(l.freeze, { entityId: e }).then(_).catch(y);
	}, { signal: a });
	function y(e) {
		p.textContent = e instanceof Error ? e.message.split("\n")[0] : String(e), p.style.color = "var(--alid-danger,#b91c1c)";
	}
	let b = t.onSelectionChange(_), x = t.onWorldMutated(_);
	return _(), () => {
		i.abort(), b(), x(), e.replaceChildren();
	};
}
function $(e, t, n, r) {
	let i = e.createElement(t);
	return i.style.cssText = n, r !== void 0 && (i.textContent = r), i;
}
function Gn(e, t, n) {
	let r = e.createElement("button");
	return r.type = "button", r.textContent = t, r.style.cssText = `appearance:none;border-radius:6px;padding:4px 9px;font:600 10.5px/1.25 system-ui,sans-serif;cursor:pointer;${n}`, r;
}
function Kn(e, t, n) {
	let r = e.createElement("span"), i = e.createElement("span");
	i.textContent = `${t} `, i.style.color = "var(--alid-text-muted,#71717a)";
	let a = e.createElement("span");
	return a.textContent = n, a.style.fontWeight = "600", r.append(i, a), r;
}
function qn(e) {
	return Number.isFinite(e) ? e === 0 ? "0" : e < .001 || e >= 1e4 ? e.toExponential(1) : e.toFixed(e < 1 ? 3 : 2) : "—";
}
// src/index.ts
var Jn = Object.freeze({ paths: Object.freeze([
	"M3 17L10 6l3 6 3-3 5 8",
	"M10 6v12",
	"M16 6v12"
]) }), Yn = {
	...u(),
	summary: n,
	aspects: [{
		...Ft,
		ui: { panels: [Rn()] }
	}, It],
	ui: {
		panels: [Un()],
		controls: [{
			id: "kite.insert.shelf",
			kind: "action",
			label: "Kite 다이어그램",
			icon: Jn,
			commandSymbol: l.insert,
			placement: "tool-shelf",
			requiresSelection: !1
		}, {
			id: "kite.add-constraint.shelf",
			kind: "action",
			label: "Kite 구속",
			icon: { paths: [
				"M4 12h6",
				"M14 12h6",
				"M12 4v6",
				"M12 14v6"
			] },
			commandSymbol: l.addConstraint,
			placement: "selection-bar",
			requiresSelection: !0
		}]
	},
	activate(e) {
		let t = [], n = xn(e);
		for (let r of n) t.push(e.commands.register(r));
		let r = new Mn(e);
		t.push(() => r.dispose());
		let i = e.services.provide?.("kite.api", Object.freeze({
			version: d.version,
			aspectIds: a,
			commands: l,
			insert: () => qt(e),
			apply: (t) => J(e, t),
			compile: (e) => R(e),
			analyze: (t) => {
				let n = Je(t, e.world.getCanonicalView());
				return Ze(n.compiled, n.state, n.pins);
			},
			freeze: () => gn(e)
		}));
		return i && t.push(i), {
			api: Object.freeze({
				insert: () => qt(e),
				apply: (t) => J(e, t),
				commands: l
			}),
			dispose() {
				for (let e of t.splice(0).reverse()) e();
				Ke();
			}
		};
	}
};
export { Yn as default };
