#!/usr/bin/env node

import net from "node:net";
import { fail } from "./utils.mjs";

export function apiSocketPath() {
  const socketPath = process.env.YURU_API_SOCKET;
  if (!socketPath) {
    fail("Yuru API is unavailable. Run this command inside a Yuru terminal.");
  }
  return socketPath;
}

export function parseApiResponse(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Yuru returned invalid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Yuru returned an invalid response.");
  }
  if (value.ok === true && Object.hasOwn(value, "data")) {
    return value;
  }
  if (
    value.ok === false &&
    value.error &&
    typeof value.error === "object" &&
    !Array.isArray(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string"
  ) {
    return value;
  }
  throw new Error("Yuru returned an invalid response.");
}

export function requestApi(command, args) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(apiSocketPath());
    socket.setEncoding("utf8");

    let input = "";
    let settled = false;

    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ command, args })}\n`);
    });
    socket.on("data", (chunk) => {
      if (settled) {
        return;
      }
      input += chunk;
      const newlineIndex = input.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      settled = true;
      socket.destroy();
      try {
        resolve(parseApiResponse(input.slice(0, newlineIndex)));
      } catch (error) {
        reject(error);
      }
    });
    socket.on("end", () => {
      if (!settled) {
        settled = true;
        reject(new Error("Yuru closed the connection without a response."));
      }
    });
    socket.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}
