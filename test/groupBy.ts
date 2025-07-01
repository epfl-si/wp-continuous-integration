import * as assert from "node:assert";
import { groupBy } from "src/lib/groupBy";

describe("groupBy", function() {
	it("groups by", function() {
		const things = [{"a": 1}, {"a": 1, "b": 2}, {"a": 2}]
		assert.deepEqual(groupBy(things, (thing) => thing.a),
			{
				1: [{"a": 1}, {"a": 1, "b": 2}],
				2: [{"a": 2}]
			})
	})
});
