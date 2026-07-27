/**
 * scripts/test-tier-h-filter.ts
 * v13.0.3: Unit tests for Tier H News Intelligence Filter.
 */

import { scoreTierHArticle } from "../src/services/tier-h-filter";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.error(`  ❌ ${message}`); }
}

async function describe(name: string, fn: () => Promise<void> | void): Promise<void> {
  console.log(`\n📋 ${name}`);
  try { await fn(); } catch (e) {
    failed++;
    console.error(`  ❌ describe() threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const now = Date.now();
const recent = now - 6 * 60 * 60 * 1000;
const old = now - 48 * 60 * 60 * 1000;

await describe("GPU launch — should pass", () => {
  const r = scoreTierHArticle("NVIDIA RTX 5090 Official Launch: 32GB GDDR7", "RTX 5090 GPU launch announcement. Gaming benchmark shows 15% improvement.", recent);
  assert(r.score >= 70, `RTX 5090 passes (score: ${r.score})`);
  assert(r.accepted === true, "Accepted");
  assert(r.positiveMatches.includes("rtx"), "Matches RTX");
  assert(r.isRecent === true, "Is recent");
  assert(r.hasLaunchWord === true, "Has launch word");
});

await describe("CPU announcement — should pass", () => {
  const r = scoreTierHArticle("AMD Ryzen 9 9950X CPU Launch: 16 Cores", "AMD announces the Ryzen 9 9950X CPU launch.", recent);
  assert(r.score >= 70, `Ryzen CPU passes (score: ${r.score})`);
  assert(r.accepted === true, "Accepted");
  assert(r.positiveMatches.includes("ryzen"), "Matches Ryzen");
});

await describe("Minor driver update — should fail", () => {
  const r = scoreTierHArticle("NVIDIA Releases Minor Driver Version 551.62", "A small software update. This minor driver version fixes bugs.", recent);
  assert(r.accepted === false, `Rejected (score: ${r.score})`);
  assert(r.negativeMatches.includes("minor driver"), "Matches negative");
});

await describe("Buying guide — should fail", () => {
  const r = scoreTierHArticle("Best GPU for 2024: Should You Buy RTX 4080?", "Our buying guide compares the best GPUs.", recent);
  assert(r.accepted === false, `Rejected (score: ${r.score})`);
  assert(r.isClickbait === true, "Is clickbait");
});

await describe("Opinion article — should fail", () => {
  const r = scoreTierHArticle("Opinion: Why Intel Arc Will Never Catch Up", "Our thoughts on Intel Arc. This opinion article is editorial.", recent);
  assert(r.accepted === false, `Rejected (score: ${r.score})`);
  assert(r.isClickbait === true, "Is clickbait (Opinion:)");
});

await describe("Firmware patch — should fail", () => {
  const r = scoreTierHArticle("ASUS Releases Tiny Firmware Patch for Z790", "A tiny firmware patch for ASUS boards.", recent);
  assert(r.accepted === false, `Rejected (score: ${r.score})`);
  assert(r.negativeMatches.includes("tiny firmware patch"), "Matches negative");
});

await describe("Benchmark article — should pass", () => {
  const r = scoreTierHArticle("RTX 5090 vs RTX 4090 Gaming Benchmark: 4K", "Gaming benchmark performance comparison at 4K.", recent);
  assert(r.score >= 70, `Benchmark passes (score: ${r.score})`);
  assert(r.accepted === true, "Accepted");
  assert(r.positiveMatches.includes("benchmark"), "Matches benchmark");
});

await describe("AI hardware — should pass", () => {
  const r = scoreTierHArticle("NVIDIA Announces Blackwell B200 AI Accelerator", "The new AI chip uses TSMC 4NP process node. AI accelerator with 208B transistors.", recent);
  assert(r.score >= 70, `AI hardware passes (score: ${r.score})`);
  assert(r.accepted === true, "Accepted");
  assert(r.positiveMatches.includes("ai accelerator"), "Matches AI accelerator");
});

await describe("Security vulnerability — should pass", () => {
  const r = scoreTierHArticle("Major Security Vulnerability in Intel CPUs: Downfall", "A major security vulnerability affects Intel CPUs. Large recall expected.", recent);
  assert(r.score >= 70, `Security passes (score: ${r.score})`);
  assert(r.accepted === true, "Accepted");
  assert(r.positiveMatches.includes("major security vulnerability"), "Matches security");
});

await describe("Clickbait title — should fail", () => {
  const r = scoreTierHArticle("Everything You Need to Know About the RTX 5090", "Everything you need to know about the new GPU.", recent);
  assert(r.accepted === false, `Rejected (score: ${r.score})`);
  assert(r.isClickbait === true, "Is clickbait");
});

await describe("Apple Silicon — should pass", () => {
  const r = scoreTierHArticle("Apple M4 Ultra Chip Announcement: 32-Core CPU", "Apple announces M4 Ultra. New Apple silicon with TSMC 3nm.", recent);
  assert(r.score >= 70, `Apple Silicon passes (score: ${r.score})`);
  assert(r.accepted === true, "Accepted");
  assert(r.positiveMatches.includes("apple silicon"), "Matches Apple Silicon");
});

await describe("Server hardware — should pass", () => {
  const r = scoreTierHArticle("AMD EPYC 9754 Server Hardware Launch: 128 Cores", "Server hardware for datacenter. AI accelerator support.", recent);
  assert(r.score >= 70, `Server hardware passes (score: ${r.score})`);
  assert(r.accepted === true, "Accepted");
  assert(r.positiveMatches.includes("server hardware"), "Matches server hardware");
});

await describe("Old article — reduced score", () => {
  const r = scoreTierHArticle("RTX 5090 Official Launch", "NVIDIA RTX 5090 GPU launch.", old);
  assert(r.isRecent === false, "Not recent");
  const r2 = scoreTierHArticle("RTX 5090 Official Launch", "NVIDIA RTX 5090 GPU launch.", recent);
  assert(r2.score >= r.score, `Recent >= old (recent: ${r2.score}, old: ${r.score})`);
});

console.log(`\n${"=".repeat(60)}`);
console.log(`📊 Tier H Filter Test Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(60)}`);

if (failed > 0) { console.error(`\n❌ ${failed} test(s) FAILED!`); process.exit(1); }
else { console.log(`\n✅ All ${passed} tests PASSED!`); process.exit(0); }
