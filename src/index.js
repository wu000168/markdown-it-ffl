/*
Based on markdown-it-katex, https://github.com/waylonflinn/markdown-it-katex
*/

/* jslint node: true */
'use strict';

import ffl from 'ffl';

// Test if potential opening or closing delimieter
// Assumes that there is a "$" at state.src[pos]
function isValidDelim(state, pos) {
    var prevChar, nextChar,
        max = state.posMax,
        can_open = true,
        can_close = true;

    prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
    nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1;

    // Check non-whitespace conditions for opening and closing, and
    // check that closing delimeter isn't followed by a number
    if (prevChar === 0x20/* " " */ || prevChar === 0x09/* \t */ ||
        (nextChar >= 0x30/* "0" */ && nextChar <= 0x39/* "9" */)) {
        can_close = false;
    }
    if (nextChar === 0x20/* " " */ || nextChar === 0x09/* \t */) {
        can_open = false;
    }

    return {
        can_open: can_open,
        can_close: can_close
    };
}

function math_inline(state, silent) {
    var start, match, token, res, pos, esc_count;

    if (state.src[state.pos] !== "$") { return false; }

    res = isValidDelim(state, state.pos);
    if (!res.can_open) {
        if (!silent) { state.pending += "$"; }
        state.pos += 1;
        return true;
    }

    // First check for and bypass all properly escaped delimieters
    // This loop will assume that the first leading backtick can not
    // be the first character in state.src, which is known since
    // we have found an opening delimieter already.
    start = state.pos + 1;
    match = start;
    while ((match = state.src.indexOf("$", match)) !== -1) {
        // Found potential $, look for escapes, pos will point to
        // first non escape when complete
        pos = match - 1;
        while (state.src[pos] === "\\") { pos -= 1; }

        // Even number of escapes, potential closing delimiter found
        if (((match - pos) % 2) == 1) { break; }
        match += 1;
    }

    // No closing delimter found.  Consume $ and continue.
    if (match === -1) {
        if (!silent) { state.pending += "$"; }
        state.pos = start;
        return true;
    }

    // Check if we have empty content, ie: $$.  Do not parse.
    if (match - start === 0) {
        if (!silent) { state.pending += "$$"; }
        state.pos = start + 1;
        return true;
    }

    // Check for valid closing delimiter
    res = isValidDelim(state, match);
    if (!res.can_close) {
        if (!silent) { state.pending += "$"; }
        state.pos = start;
        return true;
    }

    if (!silent) {
        token = state.push('math_inline', 'math', 0);
        token.markup = "$";
        token.content = state.src.slice(start, match);
    }

    state.pos = match + 1;

    var cont = state.src.slice(state.pos);
    scanFFL: if (cont[0] == '(') {
        cont = cont.slice(1);
        if (cont[0] == ')') break scanFFL;
        var endIdx = cont.length;
        try {
            ffl.parseFFL(cont);
        } catch (err) {
            if (err.found != ')') {
                break scanFFL;
            } else {
                endIdx = err.location.start.offset;
            }
        }
        state.pos++;
        if (endIdx > 0) {
            if (!silent) {
                var token = state.push('ffl_style', 'ffl', 0);
                token.markup = "\\ffl";
                token.content = cont.slice(0, endIdx);
            }
            state.pos += endIdx + 1;
        }
    }

    return true;
}

function math_block(state, start, end, silent) {
    var firstLine, lastLine, next, lastPos, found = false, token,
        pos = state.bMarks[start] + state.tShift[start],
        max = state.eMarks[start]

    if (pos + 2 > max) { return false; }
    if (state.src.slice(pos, pos + 2) !== '$$') { return false; }

    pos += 2;
    firstLine = state.src.slice(pos, max);

    if (silent) { return true; }
    if (firstLine.trim().slice(-2) === '$$') {
        // Single line expression
        firstLine = firstLine.trim().slice(0, -2);
        found = true;
    } else if ((lastPos = firstLine.lastIndexOf('$$(')) > -1) {
        firstLine = firstLine.slice(0, lastPos).trim();
        found = true;
    }

    for (next = start; !found;) {

        next++;

        if (next >= end) { break; }

        pos = state.bMarks[next] + state.tShift[next];
        max = state.eMarks[next];

        if (pos < max && state.tShift[next] < state.blkIndent) {
            // non-empty line with negative indent should stop the list:
            break;
        }

        if (state.src.slice(pos, max).trim().slice(-2) === '$$') {
            lastPos = state.src.slice(0, max).lastIndexOf('$$');
            lastLine = state.src.slice(pos, lastPos);
            found = true;
        } else if (state.src.slice(pos, max).lastIndexOf('$$(') > -1) {
            lastPos = state.src.slice(0, max).lastIndexOf('$$(');
            lastLine = state.src.slice(pos, lastPos);
            found = true;
        }
    }

    state.line = next + 1;

    token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = (firstLine && firstLine.trim() ? firstLine + '\n' : '')
        + state.getLines(start + 1, next, state.tShift[start], true)
        + (lastLine && lastLine.trim() ? lastLine : '');
    token.map = [start, state.line];
    token.markup = '$$';

    var cont = state.src.slice(lastPos + 4);
    scanFFL: {
        cont = cont.slice(1);
        if (cont[0] == ')') break scanFFL;
        var endIdx = cont.length;
        try {
            ffl.parseFFL(cont);
        } catch (err) {
            if (err.found != ')') {
                break scanFFL;
            } else {
                endIdx = err.location.start.offset;
                state.line += err.location.end.line;
            }
        }
        if (endIdx > 0) {
            if (!silent) {
                var token = state.push('ffl_style', 'ffl', 0);
                token.markup = "\\ffl";
                token.content = cont.slice(0, endIdx);
            }
        }
    }
    return true;
}

export default function math_plugin(md, options) {
    // Default options

    options = options || {};

    var inlineRenderer = function (tokens, idx) {
        options.displayMode = false;
        var style = '';
        if (options.globalStyle) style += options.globalStyle + '\n';
        try {
            return ffl.renderToString(
                tokens[idx].content,
                style + (tokens[idx + 1]?.type == 'ffl_style'
                    ? tokens[idx + 1]?.content
                    : ''), options);
        } catch (error) {
            if (options.throwOnError) { console.log(error); }
            return tokens[idx].content;
        }
    };

    var blockRenderer = function (tokens, idx) {
        options.displayMode = true;
        var style = '';
        if (options.globalStyle) style += options.globalStyle + '\n';
        try {
            return "<p align=\"center\">" + ffl.renderToString(
                tokens[idx].content,
                style + (tokens[idx + 1]?.type == 'ffl_style'
                    ? tokens[idx + 1]?.content
                    : ''), options) + "</p>";
        } catch (error) {
            if (options.throwOnError) { console.log(error); }
            return tokens[idx].content;
        }
    }

    md.inline.ruler.after('escape', 'math_inline_ffl', math_inline);
    md.block.ruler.after('blockquote', 'math_block_ffl', math_block, {
        alt: ['paragraph', 'reference', 'blockquote', 'list']
    });
    md.renderer.rules.math_inline = inlineRenderer;
    md.renderer.rules.math_block = blockRenderer;
};