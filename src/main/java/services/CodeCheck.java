package services;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.System.Logger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.util.Map;
import java.util.Properties;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import javax.script.Invocable;
import javax.script.ScriptEngine;
import javax.script.ScriptEngineManager;
import javax.script.ScriptException;

import com.horstmann.codecheck.checker.Main;
import com.horstmann.codecheck.checker.Plan;
import com.horstmann.codecheck.checker.Problem;
import com.horstmann.codecheck.checker.ResourceLoader;
import com.horstmann.codecheck.checker.Util;
import controllers.Config;

import jdk.security.jarsigner.JarSigner;

@ApplicationScoped
public class CodeCheck {
    public static final String DEFAULT_REPO = "ext";

    private static Logger logger = System.getLogger("com.horstmann.codecheck");
    private StorageConnector storeConn;
    private ResourceLoader resourceLoader;

    @Inject
    public CodeCheck(Config config, StorageConnector storeConn) {
        this.storeConn = storeConn;
        resourceLoader = config;
    }

    public Map<Path, byte[]> loadProblem(String repo, String problemName, String studentId) throws IOException, ScriptException, NoSuchMethodException {
        Map<Path, byte[]> problemFiles = loadProblem(repo, problemName);
        replaceParametersInDirectory(studentId, problemFiles);
        return problemFiles;
    }

    /**
     * @param studentId    the seed for the random number generator
     * @param problemFiles the problem files to rewrite
     * @return true if this is a parametric problem
     */
    public boolean replaceParametersInDirectory(String studentId, Map<Path, byte[]> problemFiles)
            throws ScriptException, NoSuchMethodException, IOException {
        Path paramPath = Path.of("param.js");
        if (problemFiles.containsKey(paramPath)) {
            ScriptEngineManager engineManager = new ScriptEngineManager();
            ScriptEngine engine = engineManager.getEngineByName("nashorn");
            InputStream in = resourceLoader.loadResource("preload.js");
            engine.eval(new InputStreamReader(in, StandardCharsets.UTF_8));
            //seeding unique student id
            ((Invocable) engine).invokeMethod(engine.get("Math"), "seedrandom", studentId);
            engine.eval(Util.getString(problemFiles, paramPath));
            for (Path p : Util.filterNot(problemFiles.keySet(), "param.js", "*.jar", "*.gif", "*.png", "*.jpg", "*.wav")) {
                String contents = new String(problemFiles.get(p), StandardCharsets.UTF_8);
                String result = replaceParametersInFile(contents, engine);
                if (result != null)
                    problemFiles.put(p, result.getBytes(StandardCharsets.UTF_8));
            }
            return true;
        } else return false;
    }

    private String replaceParametersInFile(String contents, ScriptEngine engine) throws ScriptException, IOException {
        if (contents == null) return null; // Happens if not UTF-8
        String leftDelimiter = (String) engine.eval("delimiters[0]");
        int leftLength = leftDelimiter.length();
        String rightDelimiter = (String) engine.eval("delimiters[1]");
        int rightLength = rightDelimiter.length();
        StringBuilder result = new StringBuilder();
        // TODO: Use length of delimiters
        int from = 0;
        int to = -rightLength;
        boolean done = false;
        while (!done) {
            from = contents.indexOf(leftDelimiter, to + rightLength);
            if (from == -1) {
                if (to == -1) return null; // No delimiter in file
                else {
                    result.append(contents.substring(to + rightLength));
                    done = true;
                }
            } else {
                int nextTo = contents.indexOf(rightDelimiter, from + leftLength);
                if (nextTo == -1) return null; // Delimiters don't match--might be binary file
                else {
                    result.append(contents.substring(to + rightLength, from));
                    to = nextTo;
                    String toEval = contents.substring(from + leftLength, to);
                    if (toEval.contains(leftDelimiter)) return null; // Nested
                    result.append("" + engine.eval(toEval));
                }
            }
        }
        return result.toString();
    }

    public Map<Path, byte[]> loadProblem(String repo, String problemName) throws IOException {
        Map<Path, byte[]> result;
        byte[] zipFile = storeConn.readProblem(repo, problemName);
        result = Util.unzip(zipFile);
        return result;
    }

    public void saveProblem(String repo, String problem, Map<Path, byte[]> problemFiles) throws IOException {
        byte[] problemZip = Util.zip(problemFiles);
        storeConn.writeProblem(problemZip, repo, problem);
    }

    public void deleteProblem(String repo, String problem) throws IOException {
        storeConn.deleteProblem(repo, problem);
    }

    public String run(String reportType, String repo,
                      String problem, String ccid, Map<Path, String> submissionFiles)
            throws IOException, InterruptedException, NoSuchMethodException, ScriptException {
        Map<Path, byte[]> problemFiles = loadProblem(repo, problem, ccid);
        // Save solution outputs if not parametric and doesn't have already have solution output
        boolean save = !problemFiles.containsKey(Path.of("param.js")) &&
                !problemFiles.keySet().stream().anyMatch(p -> p.startsWith("_outputs"));
        Properties metaData = new Properties();
        metaData.put("User", ccid);
        metaData.put("Problem", (repo + "/" + problem).replaceAll("[^\\pL\\pN_/-]", ""));

        Plan plan = new Main().run(submissionFiles, problemFiles, reportType, metaData, resourceLoader);
        if (save) {
            plan.writeSolutionOutputs(problemFiles);
            saveProblem(repo, problem, problemFiles);
        }

        return plan.getReport().getText();
    }

    /**
     * Run files with given input
     *
     * @return the report of the run
     */
    public String run(String reportType, Map<Path, String> submissionFiles)
            throws IOException, InterruptedException, NoSuchMethodException, ScriptException {
        Map<Path, byte[]> problemFiles = new TreeMap<>();
        for (var entry : submissionFiles.entrySet()) {
            var key = entry.getKey();
            problemFiles.put(key, entry.getValue().getBytes());
        }
        Properties metaData = new Properties();
        Plan plan = new Main().run(submissionFiles, problemFiles, reportType, metaData, resourceLoader);
        return plan.getReport().getText();
    }

    /**
     * Runs CodeCheck for checking a problem submission.
     * Saves the problem and the precomputed solution runs.
     */
    public String checkAndSave(String problem, Map<Path, byte[]> originalProblemFiles)
            throws IOException, InterruptedException, NoSuchMethodException, ScriptException {
        Map<Path, byte[]> problemFiles = new TreeMap<>(originalProblemFiles);
        String studentId = Util.createPronouncableUID();
        boolean isParametric = replaceParametersInDirectory(studentId, problemFiles);

        Problem p = new Problem(problemFiles);
        Map<Path, String> submissionFiles = new TreeMap<>();
        for (Map.Entry<Path, byte[]> entry : p.getSolutionFiles().entrySet())
            submissionFiles.put(entry.getKey(), new String(entry.getValue(), StandardCharsets.UTF_8));
        for (Map.Entry<Path, byte[]> entry : p.getInputFiles().entrySet())
            submissionFiles.put(entry.getKey(), new String(entry.getValue(), StandardCharsets.UTF_8));

        Properties metaData = new Properties();
        Plan plan = new Main().run(submissionFiles, problemFiles, "html", metaData, resourceLoader);
        if (!isParametric)
            plan.writeSolutionOutputs(problemFiles);
        saveProblem(DEFAULT_REPO, problem, originalProblemFiles);
        return plan.getReport().getText();
    }
}
