package controllers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;
import services.ServiceException;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.NoSuchAlgorithmException;

@RequestScoped
@jakarta.ws.rs.Path("/")
public class AssignmentController {
    @Inject services.Assignment assignmentService;
    @Context UriInfo uriInfo;
    @Context HttpHeaders headers;
    @CookieParam("ccid") String ccid;
    @CookieParam("cckey") String editKey;

    @GET
    @jakarta.ws.rs.Path("/newAssignment")
    @Produces(MediaType.TEXT_HTML)
    public Response edit() throws IOException {
        return edit(null, null);
    }

    @GET
    @jakarta.ws.rs.Path("/private/editAssignment/{assignmentID}/{editKey}")
    @Produces(MediaType.TEXT_HTML)
    public Response edit(@PathParam("assignmentID") String assignmentID, @PathParam("editKey") String key) throws IOException {
        try {
            String result = assignmentService.edit(assignmentID, key);
            return Response.ok(result).build();
        } catch (ServiceException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity(ex.getMessage()).build();
        }
    }

    @GET
    @jakarta.ws.rs.Path("/copyAssignment/{assignmentID}")
    @Produces(MediaType.TEXT_HTML)
    public Response edit(@PathParam("assignmentID") String assignmentID) throws IOException {
        return edit(assignmentID, null);
    }

    // Instructor-assigned CodeCheck IDs: letters, digits, - and _, up to 64 characters.
    // (No length limit is imposed anywhere else -- cookies, storage keys, and URL path
    // segments all comfortably fit IDs far longer than this -- 64 is just a sanity cap.)
    private static final java.util.regex.Pattern VALID_CCID = java.util.regex.Pattern.compile("[A-Za-z0-9][A-Za-z0-9_-]{0,63}");

    @GET
    @jakarta.ws.rs.Path("/assignment/{assignmentID}")
    @Produces(MediaType.TEXT_HTML)
    public Response studentStartsWork(@PathParam("assignmentID") String assignmentID,
                                       @QueryParam("ccid") String enteredCcid,
                                       @QueryParam("ccid2") String confirmCcid,
                                       @QueryParam("confirm") String confirm) throws IOException, GeneralSecurityException {
        try {
            String prefix = HttpUtil.prefix(uriInfo, headers);

            if (ccid != null && editKey != null) {
                // Returning student, same browser: cookie already identifies them.
                String result = assignmentService.work(prefix, assignmentID, ccid, editKey, true /* student */, true /* editKeySaved */);
                return Response.ok(result)
                        .cookie(HttpUtil.buildCookie("ccid", ccid))
                        .cookie(HttpUtil.buildCookie("cckey", editKey))
                        .build();
            }

            if (enteredCcid == null || enteredCcid.isBlank()) {
                String result = assignmentService.enterID(assignmentID, null);
                return Response.ok(result).build();
            }

            // The "continue as X" link from the confirmID page is server-generated
            // (not hand-typed), so it's exempt from the double-entry check below.
            if (!"true".equals(confirm)
                    && (confirmCcid == null || !enteredCcid.trim().equals(confirmCcid.trim()))) {
                String result = assignmentService.enterID(assignmentID,
                        "The two IDs you entered don't match. Please try again.");
                return Response.ok(result).build();
            }

            String candidate = enteredCcid.trim();
            if (!VALID_CCID.matcher(candidate).matches()) {
                String result = assignmentService.enterID(assignmentID,
                        "That ID contains characters that aren't allowed. Use only letters, digits, - and _.");
                return Response.ok(result).build();
            }

            if (!assignmentService.isAllowedID(assignmentID, candidate)) {
                String result = assignmentService.enterID(assignmentID,
                        "ID not recognized. Please check with your instructor.");
                return Response.ok(result).build();
            }

            if (!"true".equals(confirm) && assignmentService.hasWork(assignmentID, candidate)) {
                String result = assignmentService.confirmID(prefix, assignmentID, candidate);
                return Response.ok(result).build();
            }

            ccid = candidate;
            editKey = ccid; // the ID itself is the key: the same ID always resumes the same work, from any computer
            String result = assignmentService.work(prefix, assignmentID, ccid, editKey, true /* student */, true /* editKeySaved */);
            return Response.ok(result)
                    .cookie(HttpUtil.buildCookie("ccid", ccid))
                    .cookie(HttpUtil.buildCookie("cckey", editKey))
                    .build();
        }
        catch (ServiceException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity(ex.getMessage()).build();
        }
    }

    // Clears the ccid/cckey cookies on this computer and returns to the ID entry
    // form, for shared/lab computers. (Named/shaped for backward compatibility with
    // the existing clearIDURL link; the {ccid} path segment isn't otherwise needed.)
    @GET
    @jakarta.ws.rs.Path("/assignment/{assignmentID}/{ccid}")
    public Response studentClearsID(@PathParam("assignmentID") String assignmentID, @PathParam("ccid") String ignoredCcid) {
        // Root-relative: HttpUtil.prefix() builds paths meant for links embedded in
        // an HTML page (resolved by the browser against that page's own URL), which
        // is the wrong tool for a Location header -- it must resolve against the
        // current origin regardless of proxies/schemes, so a plain "/..." path is safest.
        return Response.seeOther(java.net.URI.create("/assignment/" + assignmentID))
                .cookie(HttpUtil.expireCookie("ccid"), HttpUtil.expireCookie("cckey"))
                .build();
    }

    @GET
    @jakarta.ws.rs.Path("/private/resume/{assignmentID}/{ccid}/{editKey}")
    @Produces(MediaType.TEXT_HTML)
    public Response studentResumesWork(@PathParam("assignmentID") String assignmentID, @PathParam("ccid") String ccid, @PathParam("editKey") String editKey) throws IOException, GeneralSecurityException {
        try {
            String prefix = HttpUtil.prefix(uriInfo, headers);
            String result = assignmentService.work(prefix, assignmentID, ccid, editKey, true /* student */, true /* editKeySaved */);
            return Response.ok(result)
                    .cookie(HttpUtil.buildCookie("ccid", ccid))
                    .cookie(HttpUtil.buildCookie("cckey", editKey))
                    .build();
        }
        catch (ServiceException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity(ex.getMessage()).build();
        }
    }

    @GET
    @jakarta.ws.rs.Path("/private/submission/{assignmentID}/{ccid}/{editKey}")
    @Produces(MediaType.TEXT_HTML)
    public Response instructorViewsStudentWork(@PathParam("assignmentID") String assignmentID, @PathParam("ccid") String ccid, @PathParam("editKey") String editKey) throws IOException, GeneralSecurityException {
        try {
            String prefix = HttpUtil.prefix(uriInfo, headers);
            String result = assignmentService.work(prefix, assignmentID, ccid, editKey, false /* student */, false /* editKeySaved */);
            return Response.ok(result).build();
        }
        catch (ServiceException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity(ex.getMessage()).build();
        }
    }

    @GET
    @jakarta.ws.rs.Path("/viewAssignment/{assignmentID}")
    @Produces(MediaType.TEXT_HTML)
    public Response instructorViewsOtherAssignment(@PathParam("assignmentID") String assignmentID) throws IOException, GeneralSecurityException {
        try {
            String prefix = HttpUtil.prefix(uriInfo, headers);
            String result = assignmentService.work(prefix, assignmentID, null /* ccid */, null /* editKey */, false /* student */, false /* editKeySaved */);
            return Response.ok(result).build();
        }
        catch (ServiceException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity(ex.getMessage()).build();
        }
    }

    @GET
    @jakarta.ws.rs.Path("/private/assignment/{assignmentID}/{editKey}")
    @Produces(MediaType.TEXT_HTML)
    public Response instructorViewsOwnAssignment(@PathParam("assignmentID") String assignmentID, @PathParam("editKey") String editKey) throws IOException, GeneralSecurityException {
        try {
            String prefix = HttpUtil.prefix(uriInfo, headers);
            String result = assignmentService.work(prefix, assignmentID, null /* ccid */, editKey, false /* student */, false /* editKeySaved */);
            return Response.ok(result).build();
        } catch (ServiceException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity(ex.getMessage()).build();
        }
    }

    @GET
    @jakarta.ws.rs.Path("/private/viewSubmissions/{assignmentID}/{editKey}")
    @Produces(MediaType.TEXT_HTML)
    public Response instructorViewsSubmissions(@PathParam("assignmentID") String assignmentID, @PathParam("editKey") String editKey) throws IOException, GeneralSecurityException {
        try {
            String result = assignmentService.viewSubmissions(assignmentID, editKey);
            return Response.ok(result).build();
        } catch (ServiceException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity(ex.getMessage()).build();
        }
    }

    @POST
    @jakarta.ws.rs.Path("/saveAssignment")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response instructorSavesAssignment(JsonNode params) throws IOException {
        try {
            // TODO: need edit key to authenticate instructor, add /private to URL
            String prefix = HttpUtil.prefix(uriInfo, headers);
            ObjectNode result = assignmentService.saveAssignment(prefix, params);
            return Response.ok(result).build();
        } catch (ServiceException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity(ex.getMessage()).build();
        }
    }

    @POST
    @jakarta.ws.rs.Path("/saveComment")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response instructorSavesComment(JsonNode params) throws IOException {
        try {
            // TODO: need edit key to authenticate instructor, add /private to URL
            ObjectNode result = assignmentService.saveComment(params);
            return Response.ok(result).build();
        } catch (ServiceException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity(ex.getMessage()).build();
        }
    }

    @POST
    @jakarta.ws.rs.Path("/saveWork")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response studentSavesWork(JsonNode params) throws IOException, NoSuchAlgorithmException {
        try {
            // TODO: auth
            ObjectNode result = assignmentService.saveWork(params);
            return Response.ok(result).build();
        } catch (ServiceException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity(ex.getMessage()).build();
        }
    }
}
