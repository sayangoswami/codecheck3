package services;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.horstmann.codecheck.checker.Util;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

import oauth.signpost.exception.OAuthException;

@ApplicationScoped
public class LTIAssignment {
    @Inject StorageConnector storageConn;
    @Inject LTI lti;
    @Inject JWT jwt;
    @Inject Assignment assignmentService;

    public String config(String host) {
        if (host.endsWith("/")) host = host.substring(0, host.length() - 1);
        return configXML.formatted(host, host, host);
    }

    private String configXML = """
<?xml version="1.0" encoding="UTF-8"?>
<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"
    xmlns:blti = "http://www.imsglobal.org/xsd/imsbasiclti_v1p0"
    xmlns:lticm ="http://www.imsglobal.org/xsd/imslticm_v1p0"
    xmlns:lticp ="http://www.imsglobal.org/xsd/imslticp_v1p0"
    xmlns:xsi = "http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation = "http://www.imsglobal.org/xsd/imslticc_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticc_v1p0.xsd
    http://www.imsglobal.org/xsd/imsbasiclti_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imsbasiclti_v1p0.xsd
    http://www.imsglobal.org/xsd/imslticm_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticm_v1p0.xsd
    http://www.imsglobal.org/xsd/imslticp_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticp_v1p0.xsd">
    <blti:title>CodeCheck</blti:title>
    <blti:description>CodeCheck Assignments</blti:description>
    <blti:icon></blti:icon>
    <blti:launch_url>https://%s/assignment</blti:launch_url>
    <blti:extensions platform="canvas.instructure.com">
      <lticm:property name="tool_id">320576af-a6a1-41f8-b634-2ee4ea4daafc</lticm:property>
      <lticm:property name="privacy_level">anonymous</lticm:property>
      <lticm:property name="domain">%s</lticm:property>
      <lticm:options name="resource_selection">
        <lticm:property name="url">https://%s/lti/createAssignment</lticm:property>
        <lticm:property name="text">CodeCheck</lticm:property>
        <lticm:property name="selection_width">1000</lticm:property>
        <lticm:property name="selection_height">800</lticm:property>
        <lticm:property name="enabled">true</lticm:property>
      </lticm:options>
    </blti:extensions>
    <cartridge_bundle identifierref="BLTI001_Bundle"/>
    <cartridge_icon identifierref="BLTI001_Icon"/>
</cartridge_basiclti_link>    		
""";

    public String assignmentOfResource(String resourceID) throws IOException {
        if (resourceID.contains(" ") ) {
            int i = resourceID.lastIndexOf(" ");
            return resourceID.substring(i + 1);
        } else {
            return storageConn.readLegacyLTIResource(resourceID);
        }
    }

    public static boolean isInstructor(Map<String, String[]> postParams) {
        String role = Util.getParam(postParams, "roles");
        return role != null && (role.contains("Faculty") || role.contains("TeachingAssistant") || role.contains("Instructor"));
    }

    /*
     * Called from Canvas and potentially other LMS with a "resource selection" interface
     */
    public String createAssignment(String url, Map<String, String[]> postParams) throws UnsupportedEncodingException {
        if (!lti.validate(url, postParams)) {
            throw new ServiceException("Failed OAuth validation");
        }

        if (!isInstructor(postParams))
            throw new ServiceException("Instructor role is required to create an assignment.");
        String userID = Util.getParam(postParams, "user_id");
        if (Util.isEmpty(userID)) throw new ServiceException("No user id");

        String toolConsumerID = Util.getParam(postParams, "tool_consumer_instance_guid");
        String userLMSID = toolConsumerID + "/" + userID;

        ObjectNode assignmentNode = JsonNodeFactory.instance.objectNode();

        String launchPresentationReturnURL = Util.getParam(postParams, "launch_presentation_return_url");
        assignmentNode.put("launchPresentationReturnURL", launchPresentationReturnURL);
        assignmentNode.put("saveURL", "/lti/saveAssignment");
        assignmentNode.put("assignmentID", Util.createPublicUID());
        assignmentNode.put("editKey", userLMSID);

        return Assignment.editAssignmentHTML.formatted(assignmentNode.toString(), false /* askForDeadline */);
    }

    // TODO Dependency on codecheck URL
    private static String assignmentIDifAssignmentURL(String url) {
        if (url.contains("\n")) return null;
        Pattern pattern = Pattern.compile("https?://codecheck.[a-z]+/(private/)?(a|viewA)ssignment/([a-z0-9]+)($|/).*");
        Matcher matcher = pattern.matcher(url);
        return matcher.matches() ? matcher.group(3) : null;
    }

    public ObjectNode saveAssignment(String host, JsonNode params) throws IOException {
        String problemText = params.get("problems").asText().trim();
        String assignmentID = assignmentIDifAssignmentURL(problemText);
        if (assignmentID == null) {
            ((ObjectNode) params).set("problems", assignmentService.parseAssignment(problemText));

            assignmentID = params.get("assignmentID").asText();
            ObjectNode assignmentNode = storageConn.readAssignment(assignmentID);
            String editKey = params.get("editKey").asText();

            if (assignmentNode != null && !editKey.equals(assignmentNode.get("editKey").asText()))
                throw new ServiceException("Edit keys do not match");

            storageConn.writeAssignment(params);
        }

        ObjectNode result = JsonNodeFactory.instance.objectNode();
        String viewAssignmentURL = "/viewAssignment/" + assignmentID;
        result.put("viewAssignmentURL", viewAssignmentURL);
        String launchURL = "https://" + host + "/assignment/" + assignmentID;
        result.put("launchURL", launchURL);

        return result; // Client will redirect to launch presentation URL
    }

    public String viewSubmissions(String resourceID) throws IOException {
        Map<String, ObjectNode> itemMap = storageConn.readAllWork(resourceID);
        String assignmentID = assignmentOfResource(resourceID);

        ObjectNode assignmentNode = storageConn.readAssignment(assignmentID);
        if (assignmentNode == null) throw new ServiceException("Assignment not found");

        ArrayNode submissions = JsonNodeFactory.instance.arrayNode();
        for (String workID : itemMap.keySet()) {
            ObjectNode work = itemMap.get(workID);
            ObjectNode submissionData = JsonNodeFactory.instance.objectNode();
            submissionData.put("opaqueID", workID);
            submissionData.put("score", services.Assignment.score(assignmentNode, work));
            submissionData.set("submittedAt", work.get("submittedAt"));
            submissionData.put("viewURL", "/lti/viewSubmission?resourceID="
                    + URLEncoder.encode(resourceID, "UTF-8")
                    + "&workID=" + URLEncoder.encode(workID, "UTF-8"));
            submissions.add(submissionData);
        }
        String allSubmissionsURL = "/lti/allSubmissions?resourceID=" + URLEncoder.encode(resourceID, "UTF-8");
        return viewSubmissionsHTML.formatted(allSubmissionsURL, submissions.toString());
    }

    private String viewSubmissionsHTML = """
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
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

    public String viewSubmission(String resourceID, String workID) throws IOException {
        String work = storageConn.readWorkString(resourceID, workID);
        if (work == null) throw new ServiceException("Work not found");
        String assignmentID = assignmentOfResource(resourceID);
        ObjectNode assignmentNode = storageConn.readAssignment(assignmentID);
        if (assignmentNode == null) throw new ServiceException("Assignment not found");
        ArrayNode groups = (ArrayNode) assignmentNode.get("problems");
        assignmentNode.set("problems", groups.get(Math.abs(workID.hashCode()) % groups.size()));
        assignmentNode.put("saveCommentURL", "/lti/saveComment");
        String comment = storageConn.readComment(resourceID, workID);
        assignmentNode.put("comment", comment);
        assignmentNode.remove("editKey");
        return Assignment.workAssignmentHTML.formatted(Assignment.scriptSafe(assignmentNode.toString()), Assignment.scriptSafe(work), workID, "undefined");
    }

    public String editAssignment(String assignmentID, String editKey) throws IOException {
        ObjectNode assignmentNode = storageConn.readAssignment(assignmentID);
        if (assignmentNode == null) throw new ServiceException("Assignment not found");

        if (!editKey.equals(assignmentNode.get("editKey").asText()))
            throw new ServiceException("Edit keys don't match");
        assignmentNode.put("saveURL", "/lti/saveAssignment");
        return Assignment.editAssignmentHTML.formatted(assignmentNode.toString(), false /* askForDeadline */);
    }

    private static ObjectNode bridgeAssignment(String url) {
        ObjectNode assignment = JsonNodeFactory.instance.objectNode();
        assignment.put("id", url);
        assignment.put("editKey", "");
        assignment.put("noHeader", true); // TODO for now
        ArrayNode groups = JsonNodeFactory.instance.arrayNode();
        ArrayNode problems = JsonNodeFactory.instance.arrayNode();
        ObjectNode problem = JsonNodeFactory.instance.objectNode();
        problem.put("URL", url);
        problem.put("weight", 1);
        problems.add(problem);
        groups.add(problems);
        assignment.set("problems", groups);
        return assignment;
    }

    private static Pattern isBridgeAssignment = Pattern.compile("^https?://.*$");

    private ObjectNode getAssignmentNode(String assignmentID) throws IOException {
        if (isBridgeAssignment.matcher(assignmentID).matches()) return bridgeAssignment(assignmentID);
        else return storageConn.readAssignment(assignmentID);
    }

    public String launch(String url, String assignmentID, Map<String, String[]> postParams) throws IOException {
        if (!lti.validate(url, postParams)) {
            throw new ServiceException("Failed OAuth validation");
        }

        String userID = Util.getParam(postParams, "user_id");
        if (Util.isEmpty(userID)) throw new ServiceException("No user id");

        String toolConsumerID = Util.getParam(postParams, "tool_consumer_instance_guid");
        String contextID = Util.getParam(postParams, "context_id");

        String userLMSID = toolConsumerID + "/" + userID;

        // TODO: In order to facilitate search by assignmentID, it would be better if this was the other way around
        String resourceID = toolConsumerID + "/" + contextID + " " + assignmentID;

        /*
        // TODO: When can we drop this?
        String resourceLinkID = Util.getParam(postParams, "resource_link_id");
        String legacyResourceID = toolConsumerID + "/" + contextID + "/" + resourceLinkID;
        String legacy = storageConn.readLegacyLTIResource(legacyResourceID);
        if (legacy != null) resourceID = legacyResourceID;
        */

        if (assignmentID == null) {
            throw new ServiceException("No assignment ID");
        }
        ObjectNode assignmentNode = getAssignmentNode(assignmentID);
        if (isInstructor(postParams)) {
            if (assignmentNode == null) throw new ServiceException("Assignment not found");
            ArrayNode groups = (ArrayNode) assignmentNode.get("problems");
            assignmentNode.set("problems", groups.get(0));
            String assignmentEditKey = assignmentNode.get("editKey").asText();

            assignmentNode.put("isStudent", false);
            assignmentNode.put("viewSubmissionsURL", "/lti/viewSubmissions?resourceID=" + URLEncoder.encode(resourceID, "UTF-8"));
            if (userLMSID.equals(assignmentEditKey)) {
                assignmentNode.put("editAssignmentURL", "/lti/editAssignment/" + assignmentID);
                assignmentNode.put("cloneURL", "/copyAssignment/" + assignmentID);
            }
            assignmentNode.put("sentAt", Instant.now().toString());
            String work = "{ problems: {} }";
            // Show the resource ID for troubleshooting
            return Assignment.workAssignmentHTML.formatted(Assignment.scriptSafe(assignmentNode.toString()), work, resourceID, "undefined" /* lti */);
        } else { // Student
            if (assignmentNode == null) throw new ServiceException("Assignment not found");
            ArrayNode groups = (ArrayNode) assignmentNode.get("problems");
            assignmentNode.set("problems", groups.get(Math.abs(userID.hashCode()) % groups.size()));
            assignmentNode.remove("editKey");

            String lisOutcomeServiceURL = Util.getParam(postParams, "lis_outcome_service_url");
            String lisResultSourcedID = Util.getParam(postParams, "lis_result_sourcedid");
            String oauthConsumerKey = Util.getParam(postParams, "oauth_consumer_key");

            ObjectNode ltiNode = JsonNodeFactory.instance.objectNode();
            if (Util.isEmpty(lisOutcomeServiceURL))
                throw new ServiceException("lis_outcome_service_url missing.");
            else
                ltiNode.put("lisOutcomeServiceURL", lisOutcomeServiceURL);

            if (Util.isEmpty(lisResultSourcedID))
                throw new ServiceException("lis_result_sourcedid missing.");
            else
                ltiNode.put("lisResultSourcedID", lisResultSourcedID);
            ltiNode.put("oauthConsumerKey", oauthConsumerKey);
            ltiNode.put("jwt", jwt.generate(Map.of("resourceID", resourceID, "userID", userID)));

            ObjectNode workNode = storageConn.readWork(resourceID, userID);
            String work = "";
            if (workNode == null)
                work = "{ problems: {} }";
            else {
                // Delete assignmentID, workID since they are in jwt token
                workNode.remove("assignmentID");
                workNode.remove("workID");
                work = workNode.toString();
            }
            String comment = storageConn.readComment(resourceID, userID);
            assignmentNode.put("comment", comment);

            assignmentNode.put("isStudent", true);
            assignmentNode.put("editKeySaved", true);
            assignmentNode.put("sentAt", Instant.now().toString());

            return Assignment.workAssignmentHTML.formatted(Assignment.scriptSafe(assignmentNode.toString()), Assignment.scriptSafe(work), userID, Assignment.scriptSafe(ltiNode.toString()));
        }
    }

    public ObjectNode allSubmissions(String resourceID) throws IOException {
        if (resourceID == null) throw new ServiceException("Assignment not found");
        Map<String, ObjectNode> itemMap = storageConn.readAllWork(resourceID);
        String assignmentID = assignmentOfResource(resourceID);

        ObjectNode assignmentNode = storageConn.readAssignment(assignmentID);
        if (assignmentNode == null) throw new ServiceException("Assignment not found");

        ObjectNode submissions = JsonNodeFactory.instance.objectNode();
        for (String workID : itemMap.keySet()) {
            ObjectNode work = itemMap.get(workID);
            submissions.set(workID, work);
        }
        return submissions;
    }

    public ObjectNode saveWork(JsonNode requestNode)
            throws IOException, NoSuchAlgorithmException, OAuthException, URISyntaxException {
        ObjectNode workNode = (ObjectNode) requestNode.get("work");
        String token = requestNode.get("jwt").asText();
        Map<String, Object> claims = jwt.verify(token);
        if (claims == null)
            throw new ServiceException("Invalid token");

        ObjectNode result = JsonNodeFactory.instance.objectNode();
        Instant now = Instant.now();
        String resourceID = claims.get("resourceID").toString();
        workNode.put("assignmentID", resourceID);
        String assignmentID = assignmentOfResource(resourceID);
        String userID = claims.get("userID").toString();
        workNode.put("workID", userID);
        String problemID = workNode.get("tab").asText();
        ObjectNode problemsNode = (ObjectNode) workNode.get("problems");
        ObjectNode submissionNode = JsonNodeFactory.instance.objectNode();
        String submissionID = resourceID + " " + userID + " " + problemID;
        submissionNode.put("submissionID", submissionID);
        submissionNode.put("submittedAt", now.toString());
        submissionNode.put("state", problemsNode.get(problemID).get("state").toString());
        submissionNode.put("score", problemsNode.get(problemID).get("score").asDouble());
        storageConn.writeSubmission(submissionNode);

        ObjectNode assignmentNode = getAssignmentNode(assignmentID);
        if (assignmentNode.has("deadline")) {
            Instant deadline = Instant.parse(assignmentNode.get("deadline").asText());
            if (now.isAfter(deadline))
                throw new ServiceException("After deadline of " + deadline);
        }
        result.put("submittedAt", now.toString());
        if (storageConn.writeWork(workNode)) {
            // Don't submit grade if this is an older submission
            submitGradeToLMS(requestNode, (ObjectNode) requestNode.get("work"), result);
        }
        return result;
    }

    public ObjectNode sendScore(JsonNode requestNode)
            throws IOException, NoSuchAlgorithmException, OAuthException, URISyntaxException {
        ObjectNode result = JsonNodeFactory.instance.objectNode();
        result.put("submittedAt", Instant.now().toString());
        String token = requestNode.get("jwt").asText();
        Map<String, Object> claims = jwt.verify(token);
        if (claims == null)
            throw new ServiceException("Invalid token");

        String userID = claims.get("userID").toString();
        String resourceID = claims.get("resourceID").toString();

        ObjectNode workNode = storageConn.readWork(resourceID, userID);
        if (workNode == null) throw new ServiceException("Work not found");
        submitGradeToLMS(requestNode, workNode, result);
        String outcome = result.get("outcome").asText();
        if (!outcome.startsWith("success")) {
            throw new ServiceException(outcome);
        }
        return result;
    }

    private void submitGradeToLMS(JsonNode params, ObjectNode work, ObjectNode result)
            throws IOException, OAuthException, NoSuchAlgorithmException, URISyntaxException {
        String outcomeServiceUrl = params.get("lisOutcomeServiceURL").asText();
        String sourcedID = params.get("lisResultSourcedID").asText();
        String oauthConsumerKey = params.get("oauthConsumerKey").asText();

        String resourceID = work.get("assignmentID").asText();
        String assignmentID = assignmentOfResource(resourceID);

        ObjectNode assignmentNode = getAssignmentNode(assignmentID);
        double score = services.Assignment.score(assignmentNode, work);
        result.put("score", score);

        String outcome = lti.passbackGradeToLMS(outcomeServiceUrl, sourcedID, score, oauthConsumerKey);
        // org.imsglobal.pox.IMSPOXRequest.sendReplaceResult(outcomeServiceUrl, oauthConsumerKey, getSharedSecret(oauthConsumerKey), sourcedId, "" + score);
        result.put("outcome", outcome);
    }

    public ObjectNode saveComment(String resourceID, JsonNode requestNode) throws IOException {
        ObjectNode result = JsonNodeFactory.instance.objectNode();
        String workID = requestNode.get("workID").asText();
        String comment = requestNode.get("comment").asText();
        // Note: The assignmentID in the request node is not useful

        ObjectNode commentNode = JsonNodeFactory.instance.objectNode();
        commentNode.put("assignmentID", resourceID);
        commentNode.put("workID", workID);
        commentNode.put("comment", comment);
        storageConn.writeComment(commentNode);
        result.put("comment", comment);
        return result;
    }
}
