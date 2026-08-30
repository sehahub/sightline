import ts from 'typescript'
import { createHost, normalizePath, type VfsHost } from './host'
import type {
  Card, CardLink, CallerHit, LinkRole, SourceFile, SymbolHit, Token, TokenClass,
} from './types'

/** Declarations that are worth showing as their own card. */
function isCardNode(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.MethodSignature:
    case ts.SyntaxKind.Constructor:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.InterfaceDeclaration:
    case ts.SyntaxKind.TypeAliasDeclaration:
    case ts.SyntaxKind.EnumDeclaration:
    case ts.SyntaxKind.ModuleDeclaration:
      return true
    default:
      return false
  }
}

/**
 * A module-level `const x = ...`, which is worth a card whether it holds a
 * function, a lookup table or a config object. Variables declared inside a
 * function body are not: the enclosing function is the useful card there.
 */
function isModuleLevelVar(n: ts.Node): n is ts.VariableStatement {
  return ts.isVariableStatement(n) && !!n.parent &&
    (ts.isSourceFile(n.parent) || ts.isModuleBlock(n.parent))
}

/**
 * Walks outward to the declaration a card should represent.
 *
 * The innermost match wins, so a callback buried in a function body resolves to
 * that function, while `export const handler = () => {}` resolves to the whole
 * statement rather than the bare arrow function.
 */
function findCardNode(node: ts.Node): ts.Node | null {
  let n: ts.Node | undefined = node
  while (n) {
    if (isCardNode(n)) return n
    if (isModuleLevelVar(n)) return n
    n = n.parent
  }
  return null
}

/** The identifier that names a card node; also the card's stable identity. */
function cardNameNode(node: ts.Node): ts.Identifier | ts.StringLiteral | null {
  if (ts.isVariableStatement(node)) {
    const d = node.declarationList.declarations[0]
    return d && ts.isIdentifier(d.name) ? d.name : null
  }
  if (ts.isVariableDeclaration(node)) return ts.isIdentifier(node.name) ? node.name : null
  if (ts.isConstructorDeclaration(node)) return null
  const name = ts.getNameOfDeclaration(node as ts.Declaration)
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name
  return null
}

function kindOf(node: ts.Node): string {
  if (ts.isVariableStatement(node) || ts.isVariableDeclaration(node)) {
    const d = ts.isVariableStatement(node) ? node.declarationList.declarations[0] : node
    const init = d?.initializer
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return 'function'
    if (init && ts.isClassExpression(init)) return 'class'
    return 'variable'
  }
  switch (node.kind) {
    case ts.SyntaxKind.FunctionDeclaration: return 'function'
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.MethodSignature: return 'method'
    case ts.SyntaxKind.Constructor: return 'constructor'
    case ts.SyntaxKind.GetAccessor: return 'getter'
    case ts.SyntaxKind.SetAccessor: return 'setter'
    case ts.SyntaxKind.ClassDeclaration: return 'class'
    case ts.SyntaxKind.InterfaceDeclaration: return 'interface'
    case ts.SyntaxKind.TypeAliasDeclaration: return 'type'
    case ts.SyntaxKind.EnumDeclaration: return 'enum'
    case ts.SyntaxKind.ModuleDeclaration: return 'module'
    default: return 'other'
  }
}

/** Name of the class/interface/module a declaration sits inside, if any. */
function containerOf(node: ts.Node): string | null {
  let p = node.parent
  while (p) {
    if (
      ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p) ||
      ts.isModuleDeclaration(p) || ts.isEnumDeclaration(p)
    ) {
      const n = ts.getNameOfDeclaration(p)
      if (n && ts.isIdentifier(n)) return n.text
    }
    p = p.parent
  }
  return null
}

/** Start offset including an attached JSDoc block, which is usually the best part. */
function spanStartWithDocs(node: ts.Node, sf: ts.SourceFile): number {
  const start = node.getStart(sf)
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? []
  const docs = ranges.filter((r) => sf.text.startsWith('/**', r.pos))
  return docs.length ? docs[0].pos : start
}

const SYNTACTIC: Record<number, TokenClass> = {
  [ts.ClassificationType.comment]: 'com',
  [ts.ClassificationType.keyword]: 'kw',
  [ts.ClassificationType.numericLiteral]: 'num',
  [ts.ClassificationType.bigintLiteral]: 'num',
  [ts.ClassificationType.operator]: 'op',
  [ts.ClassificationType.stringLiteral]: 'str',
  [ts.ClassificationType.regularExpressionLiteral]: 'str',
  [ts.ClassificationType.punctuation]: 'punc',
  [ts.ClassificationType.className]: 'type',
  [ts.ClassificationType.enumName]: 'type',
  [ts.ClassificationType.interfaceName]: 'type',
  [ts.ClassificationType.moduleName]: 'type',
  [ts.ClassificationType.typeParameterName]: 'type',
  [ts.ClassificationType.typeAliasName]: 'type',
  [ts.ClassificationType.parameterName]: 'param',
  [ts.ClassificationType.docCommentTagName]: 'com',
  [ts.ClassificationType.jsxOpenTagName]: 'jsx',
  [ts.ClassificationType.jsxCloseTagName]: 'jsx',
  [ts.ClassificationType.jsxSelfClosingTagName]: 'jsx',
  [ts.ClassificationType.jsxAttribute]: 'prop',
  [ts.ClassificationType.jsxAttributeStringLiteralValue]: 'str',
  [ts.ClassificationType.jsxText]: 'text',
}

/** Is this identifier the thing being called in foo() or a.foo()? */
function isCalleeName(id: ts.Node): boolean {
  const p = id.parent
  if (!p) return false
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) return p.expression === id
  if (ts.isPropertyAccessExpression(p) && p.name === id) {
    const gp = p.parent
    return !!gp && (ts.isCallExpression(gp) || ts.isNewExpression(gp)) && gp.expression === p
  }
  return false
}

function isInTypePosition(id: ts.Node): boolean {
  let p = id.parent
  while (p) {
    if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p)) return true
    if (ts.isExpression(p) || ts.isStatement(p)) return false
    p = p.parent
  }
  return false
}

function tokenAt(sf: ts.SourceFile, pos: number): ts.Node | null {
  let found: ts.Node | null = null
  const visit = (n: ts.Node) => {
    if (pos < n.getStart(sf) || pos > n.getEnd()) return
    found = n
    n.forEachChild(visit)
  }
  sf.forEachChild(visit)
  return found
}

export class Analyzer {
  private host: VfsHost
  private service: ts.LanguageService
  private files: Map<string, string>

  constructor(sources: SourceFile[], libs: Map<string, string> = new Map()) {
    this.files = new Map(sources.map((s) => [normalizePath(s.path), s.text]))
    this.host = createHost({ files: this.files, libs })
    this.service = ts.createLanguageService(this.host, ts.createDocumentRegistry())
  }

  get program(): ts.Program {
    const p = this.service.getProgram()
    if (!p) throw new Error('language service produced no program')
    return p
  }

  paths(): string[] {
    return this.host.paths()
  }

  private sourceFile(file: string): ts.SourceFile | undefined {
    return this.program.getSourceFile(normalizePath(file))
  }

  /** Fuzzy symbol search across the whole project. */
  search(query: string, limit = 40): SymbolHit[] {
    if (!query.trim()) return []
    const items = this.service.getNavigateToItems(query, limit, undefined, true)
    const out: SymbolHit[] = []
    for (const it of items) {
      if (!this.files.has(it.fileName)) continue
      out.push({
        name: it.name,
        kind: it.kind,
        containerName: it.containerName || null,
        file: it.fileName,
        pos: it.textSpan.start,
        matchKind: it.matchKind,
      })
    }
    return out
  }

  /** Declarations in a file, in source order. */
  outline(file: string): SymbolHit[] {
    const sf = this.sourceFile(file)
    if (!sf) return []
    const out: SymbolHit[] = []
    const visit = (node: ts.Node) => {
      if (isCardNode(node) || isModuleLevelVar(node)) {
        const name = cardNameNode(node)
        if (name) {
          out.push({
            name: name.text,
            kind: kindOf(node),
            containerName: containerOf(node),
            file: sf.fileName,
            pos: name.getStart(sf),
            matchKind: 'exact',
          })
        }
      }
      node.forEachChild(visit)
    }
    sf.forEachChild(visit)
    return out
  }

  /** Build the card for whatever declaration encloses `pos`. */
  card(file: string, pos: number): Card | null {
    const path = normalizePath(file)
    const sf = this.sourceFile(path)
    if (!sf) return null
    const token = tokenAt(sf, pos)
    if (!token) return null
    const node = findCardNode(token)
    if (!node) return null

    const start = spanStartWithDocs(node, sf)
    const end = node.getEnd()
    const nameNode = cardNameNode(node)
    const namePos = nameNode ? nameNode.getStart(sf) : node.getStart(sf)

    return {
      id: `${path}#${namePos}`,
      file: path,
      name: nameNode ? nameNode.text : kindOf(node),
      kind: kindOf(node),
      containerName: containerOf(node),
      text: sf.text.slice(start, end),
      span: { start, length: end - start },
      pos: namePos,
      startLine: sf.getLineAndCharacterOfPosition(start).line + 1,
      tokens: this.tokens(sf, start, end),
      links: this.links(sf, node, start, namePos),
    }
  }

  private tokens(sf: ts.SourceFile, start: number, end: number): Token[] {
    const span: ts.TextSpan = { start, length: end - start }
    const raw = this.service.getEncodedSyntacticClassifications(sf.fileName, span).spans
    const out: Token[] = []
    for (let i = 0; i + 2 < raw.length; i += 3) {
      const cls = SYNTACTIC[raw[i + 2]]
      if (!cls) continue
      // Classifications cover tokens that merely overlap the span, in absolute
      // file coordinates, so a token straddling either edge has to be clipped.
      const from = Math.max(raw[i], start)
      const to = Math.min(raw[i] + raw[i + 1], end)
      if (to > from) out.push({ start: from - start, length: to - from, cls })
    }
    return out
  }

  /**
   * Every identifier inside the card, resolved to the declaration it names.
   *
   * Resolution goes through the checker rather than `getDefinitionAtPosition`,
   * because the latter stops at the local import alias for imported symbols,
   * which would make every cross-file jump land on an import statement.
   */
  private links(sf: ts.SourceFile, node: ts.Node, start: number, namePos: number): CardLink[] {
    const checker = this.program.getTypeChecker()
    const links: CardLink[] = []
    const seen = new Set<number>()

    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n)) {
        const at = n.getStart(sf)
        if (at !== namePos && !seen.has(at)) {
          seen.add(at)
          const link = this.resolveLink(checker, n, at, start, namePos)
          if (link) links.push(link)
        }
      }
      n.forEachChild(visit)
    }
    node.forEachChild(visit)
    links.sort((a, b) => a.start - b.start)
    return links
  }

  private resolveLink(
    checker: ts.TypeChecker, id: ts.Identifier, at: number,
    cardStart: number, namePos: number,
  ): CardLink | null {
    const role: LinkRole = isCalleeName(id) ? 'call' : isInTypePosition(id) ? 'type' : 'ref'
    const base = { start: at - cardStart, length: id.text.length, name: id.text, role }

    let sym = checker.getSymbolAtLocation(id)
    if (sym && sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = checker.getAliasedSymbol(sym)
      } catch {
        // A broken import chain leaves the alias unresolvable; keep the alias.
      }
    }

    const decls = sym?.getDeclarations()
    if (!decls?.length) {
      return role === 'call' ? { ...base, target: null, external: true, local: false } : null
    }

    // Prefer a declaration inside the loaded project over a lib/ambient one.
    const decl = decls.find((d) => this.files.has(d.getSourceFile().fileName)) ?? decls[0]
    const declFile = decl.getSourceFile()
    if (!this.files.has(declFile.fileName)) {
      return role === 'ref' ? null : { ...base, target: null, external: true, local: false }
    }

    const cardNode = findCardNode(decl)
    if (!cardNode) return null
    const nameNode = cardNameNode(cardNode)
    const targetPos = nameNode ? nameNode.getStart(declFile) : cardNode.getStart(declFile)
    // Anything declared inside this card resolves back to the card itself, so
    // the jump would go nowhere. Recursive calls stay, and are worth marking;
    // reads of parameters and locals are just noise.
    const local = declFile.fileName === id.getSourceFile().fileName && targetPos === namePos
    if (local && role === 'ref') return null

    return { ...base, target: { file: declFile.fileName, pos: targetPos }, external: false, local }
  }

  /** Who calls the declaration named at this position. */
  callers(file: string, pos: number): CallerHit[] {
    const path = normalizePath(file)
    const incoming = this.service.provideCallHierarchyIncomingCalls(path, pos) ?? []
    return incoming.map((c) => ({
      name: c.from.name,
      kind: c.from.kind,
      file: c.from.file,
      pos: c.from.selectionSpan.start,
      sites: c.fromSpans.length,
    }))
  }

  /** Type/signature summary, for hover. */
  quickInfo(file: string, pos: number): string | null {
    const info = this.service.getQuickInfoAtPosition(normalizePath(file), pos)
    if (!info) return null
    return ts.displayPartsToString(info.displayParts)
  }
}

export { normalizePath }
