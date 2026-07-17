/**
 * Tests for FormattedPageDto.frontmatterRepresentation and the FRONTMATTER
 * CONTENT_FORMAT enum value.
 *
 * Imports from compiled build/ output.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { FormattedPageDto } from '../../build/services/snapshot-formatter.js';
import { CONTENT_FORMAT } from '../../build/dto/crawler-options.js';

function makeDto(overrides: Partial<InstanceType<typeof FormattedPageDto>> = {}): InstanceType<typeof FormattedPageDto> {
    return FormattedPageDto.from({
        url: 'https://example.com/',
        title: 'Test Page',
        description: 'A test description',
        content: '## Hello\n\nSome content.',
        ...overrides,
    }) as InstanceType<typeof FormattedPageDto>;
}

// ── enum value ───────────────────────────────────────────────────────────────

describe('CONTENT_FORMAT.FRONTMATTER', () => {
    it('has value "frontmatter"', () => {
        assert.strictEqual(CONTENT_FORMAT.FRONTMATTER, 'frontmatter');
    });
});

// ── frontmatter block structure ──────────────────────────────────────────────

describe('FormattedPageDto.frontmatterRepresentation: frontmatter block', () => {
    it('starts with --- and ends the block with ---', () => {
        const dto = makeDto();
        const lines = dto.frontmatterRepresentation!.split('\n');
        assert.strictEqual(lines[0], '---');
        const closingIdx = lines.indexOf('---', 1);
        assert.ok(closingIdx > 0, 'closing --- not found');
    });

    it('includes title as a quoted YAML field', () => {
        const dto = makeDto({ title: 'My Page' });
        assert.match(dto.frontmatterRepresentation!, /^title: "My Page"$/m);
    });

    it('includes description as a quoted YAML field', () => {
        const dto = makeDto({ description: 'Some description' });
        assert.match(dto.frontmatterRepresentation!, /^description: "Some description"$/m);
    });

    it('includes url as a quoted YAML field', () => {
        const dto = makeDto({ url: 'https://example.com/page' });
        assert.match(dto.frontmatterRepresentation!, /^url: "https:\/\/example\.com\/page"$/m);
    });

    it('includes publishedTime when present', () => {
        const dto = makeDto({ publishedTime: '2024-01-15T10:00:00Z' });
        assert.match(dto.frontmatterRepresentation!, /^publishedTime: "2024-01-15T10:00:00Z"$/m);
    });

    it('omits publishedTime when absent', () => {
        const dto = makeDto({ publishedTime: undefined });
        assert.doesNotMatch(dto.frontmatterRepresentation!, /publishedTime/);
    });

    it('omits description when empty string', () => {
        const dto = makeDto({ description: '' });
        assert.doesNotMatch(dto.frontmatterRepresentation!, /^description:/m);
    });

    it('omits title when empty string', () => {
        const dto = makeDto({ title: '' });
        assert.doesNotMatch(dto.frontmatterRepresentation!, /^title:/m);
    });

    it('includes warning in frontmatter when present', () => {
        const dto = makeDto({ warning: 'Page returned 404' });
        assert.match(dto.frontmatterRepresentation!, /^warning: "Page returned 404"$/m);
    });

    it('omits warning field when warning is absent', () => {
        const dto = makeDto({ warning: undefined });
        assert.doesNotMatch(dto.frontmatterRepresentation!, /^warning:/m);
    });
});

// ── special characters in YAML values ────────────────────────────────────────

describe('FormattedPageDto.frontmatterRepresentation: YAML-safe quoting', () => {
    it('escapes double quotes inside title', () => {
        const dto = makeDto({ title: 'She said "hello"' });
        const repr = dto.frontmatterRepresentation!;
        assert.match(repr, /^title: "She said \\"hello\\""/m);
    });

    it('handles title containing a colon', () => {
        const dto = makeDto({ title: 'Part 1: Introduction' });
        const repr = dto.frontmatterRepresentation!;
        assert.match(repr, /^title: "Part 1: Introduction"$/m);
    });

    it('handles title containing a newline (JSON-escaped)', () => {
        const dto = makeDto({ title: 'Line1\nLine2' });
        assert.match(dto.frontmatterRepresentation!, /^title: "Line1\\nLine2"$/m);
    });
});

// ── content body ─────────────────────────────────────────────────────────────

describe('FormattedPageDto.frontmatterRepresentation: content body', () => {
    it('places content after the closing ---', () => {
        const dto = makeDto({ content: '## Heading\n\nBody text.' });
        const repr = dto.frontmatterRepresentation!;
        const closingDash = repr.indexOf('\n---\n');
        const afterFrontmatter = repr.slice(closingDash + 5);
        assert.ok(afterFrontmatter.includes('## Heading'), 'content should follow the frontmatter block');
    });

    it('produces empty body when content is undefined', () => {
        const dto = makeDto({ content: undefined });
        const repr = dto.frontmatterRepresentation!;
        const closingDash = repr.indexOf('\n---\n');
        const afterFrontmatter = repr.slice(closingDash + 5).trim();
        assert.strictEqual(afterFrontmatter, '');
    });
});

// ── images summary ────────────────────────────────────────────────────────────

describe('FormattedPageDto.frontmatterRepresentation: images summary', () => {
    it('appends ## Images section when images are set', () => {
        const dto = makeDto({
            images: { 'Logo: site logo': 'https://example.com/logo.png' },
        });
        assert.match(dto.frontmatterRepresentation!, /^## Images$/m);
        assert.match(dto.frontmatterRepresentation!, /!\[Logo: site logo\]\(https:\/\/example\.com\/logo\.png\)/);
    });

    it('emits placeholder when images dict is empty', () => {
        const dto = makeDto({ images: {} });
        assert.match(dto.frontmatterRepresentation!, /This page does not seem to contain any images\./);
    });

    it('omits ## Images section when images are not set', () => {
        const dto = makeDto({ images: undefined });
        assert.doesNotMatch(dto.frontmatterRepresentation!, /## Images/);
    });
});

// ── links summary ─────────────────────────────────────────────────────────────

describe('FormattedPageDto.frontmatterRepresentation: links summary', () => {
    it('appends ## Links/Buttons section when links dict is set', () => {
        const dto = makeDto({
            links: { 'Home': 'https://example.com/' },
        });
        assert.match(dto.frontmatterRepresentation!, /^## Links\/Buttons$/m);
        assert.match(dto.frontmatterRepresentation!, /\[Home\]\(https:\/\/example\.com\/\)/);
    });

    it('appends ## Links/Buttons section when links is an array of tuples', () => {
        const dto = makeDto();
        // Assign directly to bypass Coercible.from() which doesn't preserve [string,string][] tuples
        (dto as any).links = [['About', 'https://example.com/about']] as [string, string][];
        assert.match(dto.frontmatterRepresentation!, /^## Links\/Buttons$/m);
        assert.match(dto.frontmatterRepresentation!, /\[About\]\(https:\/\/example\.com\/about\)/);
    });

    it('emits placeholder when links dict is empty', () => {
        const dto = makeDto({ links: {} });
        assert.match(dto.frontmatterRepresentation!, /This page does not seem to contain any buttons\/links\./);
    });

    it('omits ## Links/Buttons section when links are not set', () => {
        const dto = makeDto({ links: undefined });
        assert.doesNotMatch(dto.frontmatterRepresentation!, /## Links\/Buttons/);
    });
});

// ── CrawlerOptions integration ────────────────────────────────────────────────

describe('CrawlerOptions with frontmatter respondWith', () => {
    // Import CrawlerOptions lazily to share the test file pattern used elsewhere
    let CrawlerOptions: any;
    let RESPOND_TIMING: any;

    before(async () => {
        const mod = await import('../../build/dto/crawler-options.js');
        CrawlerOptions = mod.CrawlerOptions;
        RESPOND_TIMING = mod.RESPOND_TIMING;
    });

    it('browserIsNotRequired returns true for frontmatter', () => {
        const opts = Object.assign(CrawlerOptions.from({}), { respondWith: 'frontmatter' });
        assert.strictEqual(opts.browserIsNotRequired(), true);
    });

    it('readabilityRequired returns false for frontmatter (same as markdown)', () => {
        const opts = Object.assign(CrawlerOptions.from({}), { respondWith: 'frontmatter' });
        assert.strictEqual(opts.readabilityRequired(), false);
    });

    it('presumedRespondTiming returns RESOURCE_IDLE for frontmatter', () => {
        const opts = Object.assign(CrawlerOptions.from({}), { respondWith: 'frontmatter' });
        assert.strictEqual(opts.presumedRespondTiming, RESPOND_TIMING.RESOURCE_IDLE);
    });
});
