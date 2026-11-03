package nl.mariokart8.mk8dxtimetrials.scanruntime;

import com.mk8dx.mobileocr.OfflineParityPackagedRunner;

import org.json.JSONObject;

public final class ScanRuntimeFrameEnvelope {
    private ScanRuntimeFrameEnvelope() {
    }

    public static String encode(OfflineParityPackagedRunner.LiveResult result) throws Exception {
        JSONObject fields = new JSONObject();
        for (String key : result.fields.keySet()) {
            fields.put(key, result.fields.get(key));
        }
        return new JSONObject()
                .put("fields", fields)
                .put("lap_sum_ok", result.lapSumOk == null ? JSONObject.NULL : result.lapSumOk)
                .put("lap_sum_repairs", result.lapSumRepairs)
                .put("expected_field_count", result.expectedFieldCount)
                .put("kart_config", result.kartConfig == null ? JSONObject.NULL : result.kartConfig)
                .toString();
    }
}
