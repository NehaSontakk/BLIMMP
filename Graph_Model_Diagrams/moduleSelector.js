// moduleSelector.js

import { renderGraph } from "./script.js";

// URLs for your fallback JSON data
export const nodesURL     = "https://raw.githubusercontent.com/NehaSontakk/Graph-Viz/refs/heads/main/all_module_nodes.json";
export const adjacencyURL = "https://raw.githubusercontent.com/NehaSontakk/Graph-Viz/refs/heads/main/all_module_adjacency_links.json";

// State holders
let uploadedNodesData = null;
window.useDkAfter        = false;
window.currentModuleNodes = null;
window.currentModuleLinks = null;
window.currentBestPath    = null;
let threshold             = 0;

// Attempt to rehydrate from localStorage
try {
  const stored = localStorage.getItem('uploadedNodesData');
  if (stored) uploadedNodesData = JSON.parse(stored);
} catch {}
try {
  const t = parseFloat(localStorage.getItem('moduleThreshold'));
  if (!isNaN(t)) threshold = t;
} catch {}

// Simple JSON fetcher
async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Error fetching ${url}: ${resp.statusText}`);
  return resp.json();
}

let moduleDataCache = null;
async function loadAllModules() {
  if (!moduleDataCache) {
    const [nodesData, adjData] = await Promise.all([fetchJSON(nodesURL), fetchJSON(adjacencyURL)]);
    moduleDataCache = { nodesData, adjData };
  }
  return moduleDataCache;
}

// On DOM ready
window.addEventListener("DOMContentLoaded", () => {
  const uploadInput = document.getElementById("nodeJsonUpload");
  const toggleChk   = document.getElementById("neighborToggle");
  const searchBtn   = document.getElementById("searchBtn");
  const threshInput = document.getElementById("thresholdInput");
  const moduleInput = document.getElementById("moduleInput");

  // Restore threshold input
  if (threshInput) threshInput.value = threshold;

  // Handle input file
  if (uploadInput) uploadInput.addEventListener("change", async (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    try {
      const rawText = await file.text();
      const sanitized = rawText.replace(/\bNaN\b/g, "null").replace(/\bInfinity\b/g, "null");
      uploadedNodesData = JSON.parse(sanitized);
      localStorage.setItem('uploadedNodesData', JSON.stringify(uploadedNodesData));
      renderSections && renderSections();
    } catch (err) {
      alert("Failed to parse uploaded JSON:\n" + err.message);
    }
  });

  // Toggle neighbor-Dk
  if (toggleChk) toggleChk.addEventListener("change", () => {
    window.useDkAfter = toggleChk.checked;
    if (window.currentModuleNodes) renderGraph(window.currentModuleNodes, window.currentModuleLinks, window.currentBestPath, window.currentModuleId);
  });

  // Apply threshold button (if exists)
  if (document.getElementById('applyBtn')) {
    document.getElementById('applyBtn').addEventListener('click', () => {
      const val = parseFloat(threshInput.value);
      threshold = isNaN(val) ? 0 : val;
      localStorage.setItem('moduleThreshold', threshold);
      renderSections && renderSections();
    });
  }

  // Main search
  if (searchBtn) searchBtn.addEventListener("click", async () => {
    const moduleId = moduleInput.value.trim();
    if (moduleId.length !== 6) return alert("Module ID must be 6 chars e.g. M00001");
    // persist threshold
    localStorage.setItem('moduleThreshold', threshold);
    // fetch modules
    const { nodesData: allNodesData, adjData: allAdjData } = await loadAllModules();
    let moduleNodes = (uploadedNodesData?.[moduleId]?.nodes) || allNodesData[moduleId]?.nodes;
    if (!Array.isArray(moduleNodes)) moduleNodes = allNodesData[moduleId]?.nodes;
    if (!moduleNodes) return alert(`Module ${moduleId} not found`);
    moduleNodes.forEach(n => n["node-radius"] ??= 10);
    const links = allAdjData[moduleId]?.links;
    if (!links) return alert(`Links for ${moduleId} not found`);
    window.currentModuleId    = moduleId;
    window.currentModuleNodes = moduleNodes;
    window.currentModuleLinks = links;
    window.currentBestPath    = uploadedNodesData?.[moduleId]?.best_path || allNodesData[moduleId]?.best_path;
    renderGraph(moduleNodes, links, window.currentBestPath, moduleId);
  });

  // Auto-search if URL has module param
  const params = new URLSearchParams(window.location.search);
  const m = params.get('module');
  if (m) {
    moduleInput.value = m;
    // trigger upload and threshold if stored, then click
    if (uploadedNodesData) renderSections && renderSections();
    searchBtn.click();
  }
});

// Optional: expose threshold to renderSections in module.html
window.getModuleThreshold = () => threshold;
