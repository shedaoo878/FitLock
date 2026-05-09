import { mount } from "svelte";
import App from "./App.svelte";
import "../onboarding/onboarding.css"; // Reuse the same styles

mount(App, { target: document.getElementById("app") });
