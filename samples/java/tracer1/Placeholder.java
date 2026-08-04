// CodeCheck detects a problem's language from the file extensions present
// (see Language.languageFor), and tracer problems have no source file of
// their own to compile/run (the traced code lives inline in tracer.js, and
// tracer.js is exempted from the "no solution files found" check). This
// file exists only to make that detection succeed for Java tracer problems.
// It is never compiled or executed — copy it as-is into any other Java
// tracer problem directory.
public class Placeholder {
}
