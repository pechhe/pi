import { describe, expect, it } from "vitest";
import { latestForkRelease } from "../src/package-manager-cli.ts";

describe("pinned fork update channel", () => {
	it("selects the newest upstream and patch revision with an installable tarball", () => {
		const plan = latestForkRelease([
			{
				tag_name: "warm-prefix-v0.84.2.3",
				assets: [
					{
						name: "earendil-works-pi-coding-agent-0.84.2-warm.3.tgz",
						browser_download_url: "https://example.test/old.tgz",
					},
				],
			},
			{
				tag_name: "warm-prefix-v0.84.3.1",
				body: "rebased cleanly",
				assets: [
					{
						name: "earendil-works-pi-coding-agent-0.84.3-warm.1.tgz",
						browser_download_url: "https://example.test/new.tgz",
					},
				],
			},
			{ tag_name: "v0.99.0", assets: [] },
		]);

		expect(plan).toMatchObject({
			installSpec: "https://example.test/new.tgz",
			version: "0.84.3-warm.1",
			note: "rebased cleanly",
			shouldRun: true,
		});
	});

	it("ignores drafts and releases without the coding-agent tarball", () => {
		expect(
			latestForkRelease([
				{ tag_name: "warm-prefix-v0.85.0.1", draft: true, assets: [] },
				{ tag_name: "warm-prefix-v0.84.3.1", assets: [] },
			]),
		).toBeUndefined();
	});
});
