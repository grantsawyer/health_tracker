import { configurePlatform } from "../../core/platform.js";
import { memoryPlatform } from "./memoryPlatform.js";

/**
 * The platform every unit test file starts with (registered by tests/setup.ts):
 * in memory, signed in as tester@example.com with the token "test-access-token".
 * Files that need their own platform call configurePlatform() themselves.
 */
export const testPlatform = memoryPlatform({ token: "test-access-token", clientId: "123456789012-testclientid.apps.googleusercontent.com" });
configurePlatform(testPlatform.platform);
