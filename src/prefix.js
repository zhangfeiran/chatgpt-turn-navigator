// ==UserScript==
// @name         ChatGPT 轮次导航 / Turn Navigator
// @namespace    https://chatgpt.com/
// @version      1.9.8
// @description  Modular local-first navigator: safe virtualized navigation, incremental TOCs, Markdown download/copy, cached-body search and reading resume.
// @author       ChatGPT
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @match        https://chat.openai.com/*
// @icon         data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="7" fill="%2317191f"/%3E%3Cpath d="M8 9h16M8 16h11M8 23h16" stroke="%2352d4aa" stroke-width="3" stroke-linecap="round"/%3E%3C/svg%3E
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__chatgptTurnNavLoaded) return;
  window.__chatgptTurnNavLoaded = true;

  // Pure/service modules. State is private to each instance; no external dependencies.
