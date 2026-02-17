import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const INLINE_EVENT_ATTR_RE = /\bon[a-z]+\s*=\s*['"]/gi;

async function listFilesRecursively(rootDir) {
    /** @type {string[]} */
    const results = [];

    /** @type {string[]} */
    const stack = [rootDir];

    while (stack.length) {
        const current = stack.pop();
        const entries = await fs.readdir(current, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'coverage' || entry.name === 'dist') {
                    continue;
                }
                stack.push(fullPath);
                continue;
            }

            if (entry.isFile()) {
                results.push(fullPath);
            }
        }
    }

    return results;
}

function findInlineEventAttributes(sourceText) {
    /** @type {{ index: number, match: string }[]} */
    const hits = [];
    INLINE_EVENT_ATTR_RE.lastIndex = 0;
    let m;
    while ((m = INLINE_EVENT_ATTR_RE.exec(sourceText)) !== null) {
        hits.push({ index: m.index, match: m[0] });
    }
    return hits;
}

function indexToLineCol(text, index) {
    const prefix = text.slice(0, index);
    const lines = prefix.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    return { line, col };
}

describe('CSP hardening', () => {
    it('does not contain inline event handler attributes', async () => {
        const projectRoot = process.cwd();
        const allFiles = await listFilesRecursively(projectRoot);

        const candidates = allFiles.filter((filePath) => {
            const rel = path.relative(projectRoot, filePath);
            if (rel.startsWith('node_modules' + path.sep)) return false;
            if (rel.startsWith('coverage' + path.sep)) return false;
            if (rel.startsWith('dist' + path.sep)) return false;
            if (rel.startsWith('scripts' + path.sep + 'libs' + path.sep)) return false;
            const ext = path.extname(filePath).toLowerCase();
            return ext === '.html' || ext === '.js';
        });

        /** @type {string[]} */
        const violations = [];

        for (const filePath of candidates) {
            const text = await fs.readFile(filePath, 'utf8');
            const hits = findInlineEventAttributes(text);
            for (const hit of hits) {
                const { line, col } = indexToLineCol(text, hit.index);
                const rel = path.relative(projectRoot, filePath);
                violations.push(`${rel}:${line}:${col} ${hit.match.trim()}`);
            }
        }

        expect(violations).toEqual([]);
    });
});
