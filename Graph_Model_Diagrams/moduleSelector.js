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

// Simple JSON fetcher
async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Error fetching ${url}: ${resp.statusText}`);
  return resp.json();
}

// Ensure DOM is ready before querying elements
window.addEventListener("DOMContentLoaded", () => {
  const uploadInput = document.getElementById("nodeJsonUpload");
  const toggleChk   = document.getElementById("neighborToggle");
  const searchBtn   = document.getElementById("searchBtn");

  // 1) Handle file-upload control
  uploadInput.addEventListener("change", async (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    try {
      const rawText = await file.text();
      const sanitized = rawText
        .replace(/\bNaN\b/g, "null")
        .replace(/\bInfinity\b/g, "null");
      uploadedNodesData = JSON.parse(sanitized);
      console.log("Custom nodes JSON loaded");
    } catch (err) {
      alert("Failed to parse uploaded JSON:\n" + err.message);
      uploadedNodesData = null;
    }
  });

  // 2) Handle neighbor-Dk toggle
  toggleChk.addEventListener("change", () => {
    window.useDkAfter = toggleChk.checked;
    if (window.currentModuleNodes && window.currentModuleLinks) {
      renderGraph(window.currentModuleNodes, window.currentModuleLinks);
    }
  });

  // 3) Main search button handler
  searchBtn.addEventListener("click", async () => {
    const moduleId = document.getElementById("moduleInput").value.trim();
    if (moduleId.length !== 6) {
      alert("Module ID must be exactly 6 characters (e.g. M00001).");
      return;
    }

    try {
      // Fetch fallback data
      const [allNodesData, allAdjData] = await Promise.all([
        fetchJSON(nodesURL),
        fetchJSON(adjacencyURL)
      ]);

      // Choose uploaded JSON if available, else fallback
      let moduleNodes = (uploadedNodesData && uploadedNodesData[moduleId])
                         || allNodesData[moduleId];
      if (!moduleNodes) {
        alert(`Module ${moduleId} not found in nodes data.`);
        return;
      }

      // If enriched format { nodes: [...] }, unwrap
      if (moduleNodes.nodes && Array.isArray(moduleNodes.nodes)) {
        moduleNodes = moduleNodes.nodes;
      }
      if (!Array.isArray(moduleNodes)) {
        alert(`Unexpected node data format for module ${moduleId}.`);
        return;
      }

      // Ensure each node has a radius property
      moduleNodes.forEach(n => { n["node-radius"] ??= 10; });

      // Load adjacency links
      const adjObj = allAdjData[moduleId];
      if (!adjObj) {
        alert(`Module ${moduleId} not found in adjacency data.`);
        return;
      }
      const moduleLinks = adjObj.links;

      // Store for toggle re-render
      window.currentModuleNodes = moduleNodes;
      window.currentModuleLinks = moduleLinks;

      // Render
      renderGraph(moduleNodes, moduleLinks);
    } catch (err) {
      console.error(err);
      alert("Error loading module data. See console for details.");
    }
  });
});
