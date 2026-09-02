package services;


/*
 An assignment is made up of problems. A problem is provided in a URL 
 that is displayed in an iframe. (In the future, maybe friendly problems 
 could coexist on a page or shared iframe for efficiency.) An assignment 
 weighs its problems.
 
 The "problem key" is normally the problem URL. However, for interactive or CodeCheck 
 problems in the textbook repo, it is the qid of the single question in the problem.

assignmentID // non-LTI: courseID? + assignmentID, LTI: toolConsumerID/courseID + ltiResourceID, Legacy toolConsumerID/courseID/ltiResourceID
  
Assignment parsing format:
 
   Groups separated by 3 or more -
   Each line:
     urlOrQid (weight%)? title
 
*/

import java.io.IOException;
import java.net.URLEncoder;
import java.security.GeneralSecurityException;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import controllers.Config;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.horstmann.codecheck.checker.Util;

@ApplicationScoped
public class Assignment {
    @Inject StorageConnector storageConn;
    @Inject Config config;

    /*
     * assignmentID == null: new assignment
     * assignmentID != null, editKey != null: edit assignment
     * assignmentID != null, editKey == null: clone assignment
     */
	public String edit(String assignmentID, String editKey) throws IOException {
        ObjectNode assignmentNode;
        if (assignmentID == null) {
            assignmentNode = JsonNodeFactory.instance.objectNode();
        } else {
            assignmentNode = storageConn.readAssignment(assignmentID);
            if (assignmentNode == null) throw new ServiceException("Assignment not found");
            
            if (editKey == null) { // Clone
                assignmentNode.remove("editKey");
                assignmentNode.remove("assignmentID");
            }
            else { // Edit existing assignment
                if (!editKeyValid(editKey, assignmentNode)) 
                    // In the latter case, it is an LTI toolConsumerID + userID             
                    throw new ServiceException("editKey " + editKey + " does not match");
            }
        } 
        assignmentNode.put("saveURL", "/saveAssignment");
        return editAssignmentHTML.formatted(assignmentNode.toString(), true /* askForDeadline */);
	}
	
	// TODO: When this becomes a template, watch out for 90%%
	public static String editAssignmentHTML = """
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <link rel="stylesheet" href="/assets/codecheck.css"/>
    <script type="text/javascript">//<![CDATA[
    const assignment = %s
    const askForDeadline = %s
    //]]></script>
    <script src="/assets/util.js" type="text/javascript"></script>
    <script src="/assets/editAssignment.js" type="text/javascript"></script>    
    <title>Edit Assignment</title>
</head>
<body>
 <h1>Edit Assignment</h1>
 <div id='viewSubmissionsDiv'></div>
 <label style="display: block;" for="problems">Enter problem URLs or IDs, one per line:</label>
 <textarea style="display: block; width: 90%%;" id="problems" rows="10"></textarea>
 <label style="display: block;" for="roster">Allowed CodeCheck IDs, one per line (leave blank to allow any ID a student types in):</label>
 <textarea style="display: block; width: 90%%;" id="roster" rows="10"></textarea>
 <div id="deadlineDiv">
    <label style="display: block;" for="deadlineDate">Deadline (<b>Local Time</b>):</label>
    <input type="datetime-local" id="deadlineDate" name="date"/>
    <p id="deadlineLocal" style="font-weight: bold;"></p>
    <p id="deadlineUTC" style="font-weight: bold;"></p>
    <p>Leave date blank for no deadline.</p>
 </div>
 <div id='saveButtonDiv'></div>
 <div id="response" class="message" style='display: none'></div>
</body>
</html>			
""";
	
    /*
     * ccid == null, editKey == null, isStudent = true:  Student starts editing
     * ccid != null, editKey == null, isStudent = true:  Student wants to change ID (hacky)
     * ccid != null, editKey != null, isStudent = true:  Student resumes editing
     * ccid != null, editKey != null, isStudent = false: Instructor views a student submission (with the student's editKey)
     * ccid == null, editKey == null, isStudent = false: Instructor views someone else's assignment (for cloning) 
     * ccid == null, editKey != null, isStudent = false: Instructor views own assignment (for editing, viewing submissions)
     */
    public String work(String prefix, String assignmentID, String ccid, String editKey, 
            boolean isStudent, boolean editKeySaved) 
            throws IOException, GeneralSecurityException {
        String workID = "";

        ObjectNode assignmentNode = storageConn.readAssignment(assignmentID);        
        if (assignmentNode == null) throw new ServiceException("Assignment not found");
        
        assignmentNode.put("isStudent", isStudent);
                
        // TODO: Just get the ccid and cckey cookies and pass them on
        if (isStudent) {
            assignmentNode.put("clearIDURL", "/assignment/" + assignmentID + "/" + ccid);
            workID = ccid + "/" + editKey;          
        } else { // Instructor
            if (ccid == null && editKey != null && !editKeyValid(editKey, assignmentNode))
                throw new ServiceException("Edit key does not match");
            if (ccid != null && editKey != null) {  // Instructor viewing student submission
                assignmentNode.put("saveCommentURL", "/saveComment"); 
                workID = ccid + "/" + editKey;
                // Only put workID into assignmentNode when viewing submission as Instructor, for security reason
                assignmentNode.put("workID", workID);
            }
        }
        assignmentNode.remove("editKey");
        ArrayNode groups = (ArrayNode) assignmentNode.get("problems");
        assignmentNode.set("problems", groups.get(Math.abs(workID.hashCode()) % groups.size()));
        
        // Start reading work and comments
        String work = null;
        String comment = "";
        if (!workID.equals(""))  {
            work = storageConn.readWorkString(assignmentID, workID);
            comment = storageConn.readComment(assignmentID, workID);
        }
        if (work == null) 
            work = "{ assignmentID: \"" + assignmentID + "\", workID: \"" 
                + workID + "\", problems: {} }";
        assignmentNode.put("comment", comment);

        if (isStudent) {
            String returnToWorkURL = prefix + "/private/resume/" + assignmentID + "/" + ccid + "/" + editKey;
            assignmentNode.put("returnToWorkURL", returnToWorkURL); 
            assignmentNode.put("editKeySaved", editKeySaved);
            assignmentNode.put("sentAt", Instant.now().toString());
        }
        else { // Instructor
            if (ccid == null) {
                if (editKey != null) { // Instructor viewing for editing/submissions                    
                    // TODO: Check if there are any submissions?
                    assignmentNode.put("viewSubmissionsURL", "/private/viewSubmissions/" + assignmentID + "/" + editKey);
                    String publicURL = prefix + "/assignment/" + assignmentID;
                    String privateURL = prefix + "/private/assignment/" + assignmentID + "/" + editKey;
                    String editAssignmentURL = prefix + "/private/editAssignment/" + assignmentID + "/" + editKey;
                    assignmentNode.put("editAssignmentURL", editAssignmentURL);
                    assignmentNode.put("privateURL", privateURL);
                    assignmentNode.put("publicURL", publicURL);                 
                }
                String cloneURL = prefix + "/copyAssignment/" + assignmentID;
                assignmentNode.put("cloneURL", cloneURL);
            }
        }
        String lti = "undefined";
        return workAssignmentHTML.formatted(assignmentNode.toString(), work, ccid, lti);
    }
	
	// TODO: When this becomes a template, watch out for %%
    public static String workAssignmentHTML = """
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <link rel="stylesheet" href="/assets/codecheck.css"/>
    <script type="text/javascript">//<![CDATA[
    const assignment = %s
    let work = %s
    const studentID = '%s'
    const lti = %s
    //]]></script>
    <script src="/assets/util.js" type="text/javascript"></script>
    <script src="/assets/workAssignment.js" type="text/javascript"></script>
    <title>Your Assignment</title>
</head>
<body>
   <details open="open">
   <summary><h1 id="heading">Your Assignment</h1></summary>
   <div id="instructorInstructions">
      <p id="viewingAsInstructor">You are viewing this assignment as instructor.</p>
      <dl id="urls">
        <dt>Public URL for your students:</dt><dd><span id="publicURL" class="ccurl"></span></dd>
        <dt>Private URL for you only:</dt><dd><span id="privateURL" class="ccurl"></span></dd>  
      </dl>     
      <div id="instructor_comment_div">
        <label id="label_feedback_instruction">Your comments:</label><br>
        <textarea style="display: block; width: 80%%; font-size: 14px; font-weight: 500;" id="instructor_comment" rows="10"></textarea>
        <div id='saveButtonDiv'></div>
      </div>
   </div>
   <div id="studentInstructions">
	   <p>Your CodeCheck ID: <span class="ccid"></span></p>
	   <ul id="ccidBullets">
	     <li>Enter this same ID on any computer to resume your work</li>
	     <li id="clearID">If you work on a shared computer, clear the ID after you are done</li>
	   </ul>
	   <dl>
	     <dt>Use this private URL for resuming your work later:</dt>
	     <dd id="returnToWork"><span id="returnToWorkURL" class="ccurl"></span></dd>  
	   </dl>
     <p id="deadline" style="font-weight: bold;"></p>
     <p id="deadlineLocal" style="font-weight: bold;"></p>
     <p id="deadlineUTC" style="font-weight: bold;"></p>
	   <label id="savedcopy" style="display: block;"><input type="checkbox"/>  I saved a copy of the private URL</label>
   </div>
   <div id="studentLTIInstructions">
     <p>You are viewing this assignment from a Learning Management System (LMS)</p>
     <p>Your LMS ID: <span class="ccid"></span></p>
     <p>Wrong score in LMS? <span id="submitLTIButton"></span></p>
   </div>
   <div id="student_comment_div">
     <label for="student_comment">Feedback from your instructor:</label><br>
     <textarea readonly style="display: block; width: 80%%; font-size: 14px; font-weight: 500;" id="student_comment" rows="10"></textarea>
   </div>
  <p class="message" id="response" role="status" aria-live="polite"></p>
  <p id="abovebuttons">Click on the buttons below to view all parts of the assignment.</p>
  </details>
</body>
</html>    		
""";

    // Does this instructor-assigned ID already have saved work for this assignment?
    // Used to confirm a student isn't landing on someone else's submission by typo.
    public boolean hasWork(String assignmentID, String ccid) throws IOException {
        return storageConn.readWork(assignmentID, ccid + "/" + ccid) != null;
    }

    // If the instructor uploaded a roster for this assignment, only those exact IDs
    // are accepted -- this both rejects typos immediately (instead of silently
    // creating an orphaned submission) and prevents an unbounded number of storage
    // records being created by IDs nobody was ever given.
    // No roster uploaded: any validly-formatted ID is allowed (today's behavior).
    public boolean isAllowedID(String assignmentID, String ccid) throws IOException {
        ObjectNode assignmentNode = storageConn.readAssignment(assignmentID);
        if (assignmentNode == null) throw new ServiceException("Assignment not found");
        if (!assignmentNode.has("roster") || assignmentNode.get("roster").isEmpty())
            return true;
        for (JsonNode idNode : assignmentNode.get("roster"))
            if (idNode.asText().equals(ccid)) return true;
        return false;
    }

    public String enterID(String assignmentID, String message) throws IOException {
        if (storageConn.readAssignment(assignmentID) == null)
            throw new ServiceException("Assignment not found");
        // #B00020 on white is ~7:1 contrast (WCAG AA needs 4.5:1); plain "red" is
        // only ~4:1 and fails. role="alert" flags it as important to assistive tech.
        String messageHTML = (message == null || message.isBlank())
                ? ""
                : "<p role=\"alert\" style=\"color: #B00020; font-weight: bold;\">" + message + "</p>";
        return enterIDHTML.formatted(messageHTML);
    }

    private static String enterIDHTML = """
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <link rel="stylesheet" href="/assets/codecheck.css"/>
    <title>Enter Your CodeCheck ID</title>
</head>
<body>
  <h1>Enter Your CodeCheck ID</h1>
  <p>Enter the CodeCheck ID your instructor gave you. Use the same ID every time to resume your work, on any computer.</p>
  %s
  <form method="GET" action="">
    <label style="display: block;" for="ccid">Your ID:</label>
    <input type="text" id="ccid" name="ccid" autofocus="autofocus" required="required" />
    <label style="display: block;" for="ccid2">Enter it again to confirm:</label>
    <input type="text" id="ccid2" name="ccid2" required="required" />
    <input type="submit" value="Continue" />
  </form>
</body>
</html>
""";

    public String confirmID(String prefix, String assignmentID, String ccid) throws IOException {
        if (storageConn.readAssignment(assignmentID) == null)
            throw new ServiceException("Assignment not found");
        String safeCcid = org.apache.commons.text.StringEscapeUtils.escapeHtml4(ccid);
        String continueURL = prefix + "/assignment/" + assignmentID + "?ccid="
                + URLEncoder.encode(ccid, "UTF-8") + "&confirm=true";
        String backURL = prefix + "/assignment/" + assignmentID;
        return confirmIDHTML.formatted(safeCcid, continueURL, safeCcid, backURL);
    }

    private static String confirmIDHTML = """
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <link rel="stylesheet" href="/assets/codecheck.css"/>
    <title>Confirm Your CodeCheck ID</title>
</head>
<body>
  <h1>Welcome back, %s?</h1>
  <p>This CodeCheck ID already has saved work for this assignment.</p>
  <p><a href="%s">Yes, continue as %s</a></p>
  <p><a href="%s">This isn't my ID &mdash; let me enter a different one</a></p>
</body>
</html>
""";

    public String viewSubmissions(String assignmentID, String editKey)
            throws IOException {
        ObjectNode assignmentNode = storageConn.readAssignment(assignmentID);
        if (assignmentNode == null) throw new ServiceException("Assignment not found");
        
        if (!editKeyValid(editKey, assignmentNode))
            throw new ServiceException("Edit key does not match");

        ArrayNode submissions = JsonNodeFactory.instance.arrayNode();

        Map<String, ObjectNode> itemMap = storageConn.readAllWork(assignmentID); 

        for (String submissionKey : itemMap.keySet()) {
            String[] parts = submissionKey.split("/");
            String ccid = parts[0];
            String submissionEditKey = parts[1];
            
            ObjectNode work = itemMap.get(submissionKey);
            ObjectNode submissionData = JsonNodeFactory.instance.objectNode();
            submissionData.put("opaqueID", ccid);
            submissionData.put("score", Assignment.score(assignmentNode, work));
            submissionData.set("submittedAt", work.get("submittedAt"));
            submissionData.put("viewURL", "/private/submission/" + assignmentID + "/" + ccid + "/" + submissionEditKey); 
            submissions.add(submissionData);            
        }
        String allSubmissionsURL = "/lti/allSubmissions?resourceID=" + URLEncoder.encode(assignmentID, "UTF-8");
        return viewSubmissionsHTML.formatted(allSubmissionsURL, submissions.toString());    
    }
    
    private String viewSubmissionsHTML = """
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <link rel="stylesheet" href="/assets/codecheck.css"/>
    <script type="text/javascript">//<![CDATA[
    const allSubmissionsURL = '%s'
    const submissionData = %s
    //]]></script>
    <script src="/assets/util.js" type="text/javascript"></script>
    <script src="/assets/viewSubmissions.js" type="text/javascript"></script>
    <title>Assignment Submissions</title>
</head>
<body>
  
</body>
</html>    		
""";
    
    /*
     * Save existing: request.assignmentID, request.editKey exist
     * New or cloned: Neither request.assignmentID nor request.editKey exist
     */
    public ObjectNode saveAssignment(String prefix, JsonNode params) throws IOException {
        ((ObjectNode) params).set("problems", parseAssignment(params.get("problems").asText()));
        if (params.has("roster"))
            ((ObjectNode) params).set("roster", parseRoster(params.get("roster").asText()));
        String assignmentID;
        String editKey;
        ObjectNode assignmentNode;
        if (params.has("assignmentID")) {
            assignmentID = params.get("assignmentID").asText();
            assignmentNode = storageConn.readAssignment(assignmentID);
            if (assignmentNode == null) throw new ServiceException("Assignment not found");

            if (!params.has("editKey")) throw new ServiceException("Missing edit key");
            editKey = params.get("editKey").asText();
            if (!editKeyValid(editKey, assignmentNode))
                throw new ServiceException("Edit key does not match");
        }
        else { // New assignment or clone
            assignmentID = Util.createPublicUID();
            ((ObjectNode) params).put("assignmentID", assignmentID);
            if (params.has("editKey"))
                editKey = params.get("editKey").asText();
            else { // LTI assignments have an edit key
                editKey = Util.createPrivateUID();
                ((ObjectNode) params).put("editKey", editKey);
            }
            assignmentNode = null;
        }
        storageConn.writeAssignment(params);

        String assignmentURL = prefix + "/private/assignment/" + assignmentID + "/" + editKey;
        ((ObjectNode) params).put("viewAssignmentURL", assignmentURL);

        return (ObjectNode) params;
    }

    /**
     * Deletes an assignment, authorised by its (non-LTI) edit key. Student work,
     * submissions and comments for the assignment are left in storage.
     */
    public void deleteAssignment(String assignmentID, String editKey) throws IOException {
        ObjectNode assignmentNode = storageConn.readAssignment(assignmentID);
        if (assignmentNode == null)
            throw new ServiceException("Assignment not found");
        if (!editKeyValid(editKey, assignmentNode))
            throw new SecurityException("Edit key does not match");
        storageConn.deleteAssignment(assignmentID);
    }

    public String qidURL(String qid) {
        String patterns = config.getString("com.horstmann.codecheck.qid.patterns");
        if (patterns == null) return null;
        if (qid.matches("[a-zA-Z0-9_]+(-[a-zA-Z0-9_]+)*")) {
            for (String pattern : patterns.split(",")) {
                String problemURL = pattern.formatted(qid);
                if (Util.exists(problemURL))
                    return problemURL;
            }
        }
        return null;
    }
    
    public ArrayNode parseRoster(String roster) {
        ArrayNode result = JsonNodeFactory.instance.arrayNode();
        if (roster == null) return result;
        for (String line : roster.split("\\r?\\n")) {
            String trimmed = line.trim();
            if (!trimmed.isEmpty()) result.add(trimmed);
        }
        return result;
    }

    public ArrayNode parseAssignment(String assignment) {
        if (assignment == null || assignment.trim().isEmpty()) 
            throw new ServiceException("No assignments");
        ArrayNode groupsNode = JsonNodeFactory.instance.arrayNode();
        Pattern problemPattern = Pattern.compile("\\s*(\\S+)(\\s+[0-9.]+%)?(.*)");
        String[] groups = assignment.split("\\s+-{3,}\\s+");
        for (int problemGroup = 0; problemGroup < groups.length; problemGroup++) {
            String[] lines = groups[problemGroup].split("\\n+");
            if (lines.length == 0) throw new ServiceException("No problems given");
            ArrayNode group = JsonNodeFactory.instance.arrayNode();
            for (int i = 0; i < lines.length; i++) {
                ObjectNode problem = JsonNodeFactory.instance.objectNode();
                Matcher matcher = problemPattern.matcher(lines[i]);
                if (!matcher.matches())
                    throw new ServiceException("Bad input " + lines[i]);
                String problemDescriptor = matcher.group(1); // URL or qid
                String problemURL;
                String qid = null;
                boolean checked = false;
                if (problemDescriptor.startsWith("!")) { // suppress checking
                	checked = true;
                	problemDescriptor = problemDescriptor.substring(1);
                }
                if (problemDescriptor.startsWith("https")) problemURL = problemDescriptor;
                else if (problemDescriptor.startsWith("http")) {
                    if (!problemDescriptor.startsWith("http://localhost") && !problemDescriptor.startsWith("http://127.0.0.1")) {
                        problemURL = "https" + problemDescriptor.substring(4);
                    }
                    else
                        problemURL = problemDescriptor;                    
                }   
                else {
                    problemURL = qidURL(problemDescriptor);
                    if (problemURL != null) {
                        qid = problemDescriptor;
                        checked = true;
                    }
                    else throw new ServiceException("Bad problem: " + problemDescriptor);
                }
                if (!checked && !Util.exists(problemURL))
                    throw new ServiceException("Cannot find " + problemDescriptor);             
                problem.put("URL", problemURL);
                if (qid != null) problem.put("qid", qid);
                
                String weight = matcher.group(2);
                if (weight == null) weight = "100";
                else weight = weight.trim().replace("%", "");
                problem.put("weight", Double.parseDouble(weight) / 100);

                String title = matcher.group(3);
                if (title != null) { 
                    title = title.trim();
                    if (!title.isEmpty())
                        problem.put("title", title);
                }
                // TODO A user had 100 120 80 0 as percentages, without a %
                // Fix this in the future by putting up an error if all the titles are numbers, which surely isn't what people wanted.
                group.add(problem);
            }
            groupsNode.add(group);
        }
        return groupsNode;
    }
    
    private static boolean isProblemKeyFor(String key, ObjectNode problem) {        
        // Textbook repo
        if (problem.has("qid")) return problem.get("qid").asText().equals(key);
        String problemURL = problem.get("URL").asText();
        // Some legacy CodeCheck questions have butchered keys such as 0101407088y6iesgt3rs6k7h0w45haxajn 
        return problemURL.endsWith(key);
    }
             
    public static double score(JsonNode assignment, ObjectNode work) {
        ArrayNode groups = (ArrayNode) assignment.get("problems");      
        String workID = work.get("workID").asText();
        ArrayNode problems = (ArrayNode) groups.get(workID.hashCode() % groups.size());
        ObjectNode submissions = (ObjectNode) work.get("problems");
        double result = 0;
        double sum = 0;
        for (JsonNode p : problems) {
            ObjectNode problem = (ObjectNode) p;
            double weight = problem.get("weight").asDouble();
            sum += weight;
            for (String key : Util.iterable(submissions.fieldNames())) {
                if (isProblemKeyFor(key, problem)) {    
                    ObjectNode submission = (ObjectNode) submissions.get(key);
                    result += weight * submission.get("score").asDouble();
                }
            }           
        }
        return sum == 0 ? 0 : result / sum;
    }
    
    private static boolean editKeyValid(String suppliedEditKey, ObjectNode assignmentNode) {
        String storedEditKey = assignmentNode.get("editKey").asText();
        return suppliedEditKey.equals(storedEditKey) && !suppliedEditKey.contains("/");
          // Otherwise it's an LTI edit key (tool consumer ID + user ID)
    }
    
    public ObjectNode saveWork(JsonNode requestNode) throws IOException, NoSuchAlgorithmException {
        ObjectNode result = JsonNodeFactory.instance.objectNode();
        
        Instant now = Instant.now();
        String assignmentID = requestNode.get("assignmentID").asText();
        ObjectNode assignmentNode = storageConn.readAssignment(assignmentID);
        if (assignmentNode == null) throw new ServiceException("Assignment not found");
        String workID = requestNode.get("workID").asText();
        String problemID = requestNode.get("tab").asText();
        ObjectNode problemNode = (ObjectNode) requestNode.get("problems").get(problemID);

        String submissionID = assignmentID + " " + workID + " " + problemID; 
        ObjectNode submissionNode = JsonNodeFactory.instance.objectNode();
        submissionNode.put("submissionID", submissionID);
        submissionNode.put("submittedAt", now.toString());
        submissionNode.put("state", problemNode.has("state") ? problemNode.get("state").toString() : null);
        submissionNode.put("score", problemNode.has("score") ? problemNode.get("score").asDouble() : 0.0);
        storageConn.writeSubmission(submissionNode);
        
        if (assignmentNode.has("deadline")) {
            Instant deadline = Instant.parse(assignmentNode.get("deadline").asText());
            if (now.isAfter(deadline)) 
                throw new ServiceException("After deadline of " + deadline);
        }
        result.put("submittedAt", now.toString());      

        storageConn.writeWork(requestNode);        
        return result;
    }
    
    public ObjectNode saveComment(JsonNode requestNode) throws IOException {
        ObjectNode result = JsonNodeFactory.instance.objectNode();
        String assignmentID = requestNode.get("assignmentID").asText();
        String workID = requestNode.get("workID").asText();
        String comment = requestNode.get("comment").asText();
        
        ObjectNode commentNode = JsonNodeFactory.instance.objectNode();
        commentNode.put("assignmentID", assignmentID);
        commentNode.put("workID", workID);
        commentNode.put("comment", comment);
        storageConn.writeComment(commentNode);
        result.put("comment", comment);
        //result.put("refreshURL", "/private/submission/" + assignmentID + "/" + workID);
        return result;
    } 
}
