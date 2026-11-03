package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The Java time decision against the Python reference (packages/icon-matcher/vectors/time-decision-v1.json). */
public class TimeDecisionParityTest {
    private static List<String> strings(JSONArray array) throws Exception {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) out.add(array.getString(i));
        return out;
    }

    @Test
    public void javaDecisionEqualsPython() throws Exception {
        Path fixture = Paths.get("../../../packages/icon-matcher/vectors/time-decision-v1.json");
        JSONObject doc = new JSONObject(new String(Files.readAllBytes(fixture), "UTF-8"));
        int differences = 0;
        JSONArray closures = doc.getJSONArray("closures");
        for (int i = 0; i < closures.length(); i++) {
            JSONObject c = closures.getJSONObject(i);
            TimeDecision.Repair got = TimeDecision.lapSumClosure(strings(c.getJSONArray("texts")));
            JSONObject want = c.optJSONObject("repair");
            boolean same = want == null ? got == null : got != null && got.field == want.getInt("field")
                    && got.pos == want.getInt("pos") && got.from.equals(want.getString("from"))
                    && got.to.equals(want.getString("to")) && got.kind.equals(want.getString("kind"));
            if (!same) differences++;
        }
        JSONArray completes = doc.getJSONArray("completes");
        for (int i = 0; i < completes.length(); i++) {
            JSONObject c = completes.getJSONObject(i);
            List<TimeDecision.OwnerTimes> owners = new ArrayList<>();
            JSONArray rows = c.getJSONArray("owners");
            for (int k = 0; k < rows.length(); k++) {
                JSONObject o = rows.getJSONObject(k);
                owners.add(new TimeDecision.OwnerTimes(o.isNull("total") ? null : o.getString("total"),
                        strings(o.getJSONArray("laps"))));
            }
            if (TimeDecision.lapSumComplete(owners) != c.getBoolean("complete")) differences++;
        }
        JSONArray guards = doc.getJSONArray("guards");
        for (int i = 0; i < guards.length(); i++) {
            JSONObject c = guards.getJSONObject(i);
            if (TimeDecision.repairGuardApplies(c.getBoolean("lapSumOk"), c.getInt("repairs"),
                    c.getDouble("minConfidence")) != c.getBoolean("guard")) differences++;
        }
        System.out.println("time decision parity differences=" + differences);
        assertEquals(0, differences);
    }
}
