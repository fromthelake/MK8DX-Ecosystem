package nl.mariokart8.iconmatcher;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The pinned shared-icon reference pack (references.json + tensors), read
 * through any byte source (Android assets, a private QA folder). Every tensor
 * is checked against its manifest size and SHA-256.
 */
public final class ReferencePack {
    public interface Source {
        byte[] read(String name) throws Exception;
    }

    public final String catalogSha256;
    public final JSONObject manifest;
    private final Map<String, IconGroup> groups = new HashMap<>();

    public ReferencePack(Source source, String... groupKeys) throws Exception {
        manifest = new JSONObject(new String(source.read("references.json"), StandardCharsets.UTF_8));
        if (!"mk8dx.shared-icon-references.v1".equals(manifest.getString("schema"))) {
            throw new IllegalStateException("unexpected reference schema");
        }
        catalogSha256 = manifest.getString("catalogSha256");
        JSONObject specs = manifest.getJSONObject("groups");
        for (String key : groupKeys) groups.put(key, load(source, specs.getJSONObject(key)));
    }

    /** Group by key, e.g. {@code flags__result}. */
    public IconGroup group(String key) {
        IconGroup group = groups.get(key);
        if (group == null) throw new IllegalArgumentException("group not loaded: " + key);
        return group;
    }

    private static IconGroup load(Source source, JSONObject spec) throws Exception {
        JSONArray size = spec.getJSONArray("size");
        JSONArray idArray = spec.getJSONArray("ids");
        JSONArray familyArray = spec.getJSONArray("families");
        String[] ids = new String[idArray.length()];
        String[] families = new String[ids.length];
        for (int i = 0; i < ids.length; i++) {
            ids[i] = idArray.getString(i);
            families[i] = familyArray.getString(i);
        }
        JSONObject tensors = spec.getJSONObject("tensors");
        return new IconGroup(size.getInt(0), size.getInt(1), ids, families,
                floats(tensor(source, tensors.getJSONObject("rgb"))),
                tensor(source, tensors.getJSONObject("mask")),
                floats(tensor(source, tensors.getJSONObject("count"))));
    }

    private static byte[] tensor(Source source, JSONObject spec) throws Exception {
        String file = spec.getString("file");
        if (!file.matches("[a-z0-9_.-]+")) throw new IllegalStateException("unsafe tensor name");
        byte[] bytes = source.read(file);
        if (bytes.length != spec.getInt("bytes") || !sha256(bytes).equals(spec.getString("sha256"))) {
            throw new IllegalStateException("tensor checksum mismatch: " + file);
        }
        return bytes;
    }

    public static float[] floats(byte[] bytes) {
        float[] out = new float[bytes.length / 4];
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(out);
        return out;
    }

    public static String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }
}
