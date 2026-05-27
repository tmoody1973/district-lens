from app.tools.mongodb_mcp_query import parse_count_text


def test_parse_count_text_extracts_number():
    text = 'Found 4 documents in the collection "candidates" that matched the query.'
    assert parse_count_text(text) == 4


def test_parse_count_text_handles_singular():
    assert parse_count_text("Found 1 document in the collection.") == 1


def test_parse_count_text_none_when_no_match():
    assert parse_count_text("no count here") is None
    assert parse_count_text("") is None
