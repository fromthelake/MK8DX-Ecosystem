package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Same vector as python/tests/test_result_proposal.py and ts/sharedResultProposal.test.mjs. */
public class GhostSelectProfileTest {
    private static JSONObject read(String kind, String id) throws Exception {
        JSONArray top = new JSONArray().put(new JSONObject().put("id", id).put("familyId", id).put("score", .9));
        return new JSONObject().put("schema", "mk8dx.visual-field-read.v1").put("kind", kind).put("profile", "ghost_select")
                .put("status", "accepted").put("acceptedId", id).put("top1Id", id).put("cropPixelSha256", "c")
                .put("catalogSha256", "k").put("top", top);
    }

    @Test
    public void aGhostSelectCharacterReadIsValidOnlyForTheCharacter() throws Exception {
        JSONObject fields = ResultProposal.compose(new JSONObject()
                .put("character", new JSONObject().put("shared_icon_qa", read("characters", "character.mario")))
                .put("kart", new JSONObject().put("shared_icon_qa", read("bodies", "body.pipe_frame"))))
                .getJSONObject("fields");
        assertEquals("character.mario", fields.getJSONObject("character").getString("acceptedId"));
        assertEquals("unavailable", fields.getJSONObject("kart").getString("status"));
    }
}
