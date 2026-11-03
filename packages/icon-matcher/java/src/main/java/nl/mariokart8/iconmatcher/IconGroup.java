package nl.mariokart8.iconmatcher;

/**
 * One pinned reference group (sharedIconScorer.ts IconTensorGroup): normalized
 * RGB in 0..1 per reference, a 0/1 alpha mask and the masked pixel count.
 */
public final class IconGroup {
    public final int width;
    public final int height;
    public final String[] ids;
    public final String[] families;
    public final float[] rgb;
    public final byte[] mask;
    public final float[] count;
    /** Per reference: the RGB offsets of its masked pixels, in pixel order. */
    final int[][] masked;

    public IconGroup(int width, int height, String[] ids, String[] families, float[] rgb, byte[] mask, float[] count) {
        int pixels = width * height;
        if (ids.length < 2 || families.length != ids.length || rgb.length != ids.length * pixels * 3
                || mask.length != ids.length * pixels || count.length != ids.length) {
            throw new IllegalArgumentException("Incompatible icon tensor shape");
        }
        this.width = width;
        this.height = height;
        this.ids = ids;
        this.families = families;
        this.rgb = rgb;
        this.mask = mask;
        this.count = count;
        masked = new int[ids.length][];
        for (int index = 0; index < ids.length; index++) {
            int n = 0;
            for (int pixel = 0; pixel < pixels; pixel++) {
                if (mask[index * pixels + pixel] != 0) n++;
            }
            int[] offsets = new int[n];
            n = 0;
            for (int pixel = 0; pixel < pixels; pixel++) {
                if (mask[index * pixels + pixel] != 0) offsets[n++] = pixel * 3;
            }
            masked[index] = offsets;
        }
    }

    public int indexOf(String id) {
        for (int i = 0; i < ids.length; i++) {
            if (ids[i].equals(id)) return i;
        }
        return -1;
    }
}
